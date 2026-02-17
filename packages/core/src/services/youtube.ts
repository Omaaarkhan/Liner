import { readdir } from "node:fs/promises";
import path from "node:path";
import type { DownloadSpeedProfile, QualityMode, YouTubeFormatInfo, YouTubeVideoInfo } from "@audio-ripper/shared";
import { runCommand } from "../utils/process.js";
import { resolveBinaryCommand } from "./binary-paths.js";

interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  acodec?: string;
  vcodec?: string;
  abr?: number;
  tbr?: number;
  filesize?: number;
}

interface YtDlpDump {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  description?: string;
  webpage_url?: string;
  thumbnail?: string;
  duration?: number;
  formats?: YtDlpFormat[];
}

interface DownloadPlan {
  format: string;
  extractorArgs?: string;
  fragments: number[];
  notice?: string;
}

export class YouTubeExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeExtractionError";
  }
}

function toFormatInfo(format: YtDlpFormat): YouTubeFormatInfo | null {
  if (!format.format_id) {
    return null;
  }

  const abr = Number.isFinite(format.abr) ? Number(format.abr) : undefined;
  const tbr = Number.isFinite(format.tbr) ? Number(format.tbr) : undefined;
  const filesize = Number.isFinite(format.filesize) ? Number(format.filesize) : undefined;

  return {
    formatId: format.format_id,
    ext: format.ext,
    acodec: format.acodec,
    vcodec: format.vcodec,
    abr,
    tbr,
    filesize,
    audioQualityScore: abr ?? tbr ?? 0
  };
}

function selectBestAudioFormat(formats: YtDlpFormat[] = []): YouTubeFormatInfo {
  const audioOnly = formats
    .map(toFormatInfo)
    .filter((item): item is YouTubeFormatInfo => Boolean(item))
    .filter((format) => format.acodec && format.acodec !== "none")
    .filter((format) => !format.vcodec || format.vcodec === "none");

  const candidates = audioOnly.length > 0
    ? audioOnly
    : formats.map(toFormatInfo).filter((item): item is YouTubeFormatInfo => Boolean(item));

  if (candidates.length === 0) {
    throw new YouTubeExtractionError("No downloadable formats were returned by yt-dlp.");
  }

  candidates.sort((a, b) => {
    const scoreDiff = (b.audioQualityScore ?? 0) - (a.audioQualityScore ?? 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const fileDiff = (b.filesize ?? 0) - (a.filesize ?? 0);
    if (fileDiff !== 0) {
      return fileDiff;
    }

    return (b.tbr ?? 0) - (a.tbr ?? 0);
  });

  return candidates[0];
}

function selectBestVideoFormat(formats: YtDlpFormat[] = []): YouTubeFormatInfo {
  const videoCandidates = formats
    .map(toFormatInfo)
    .filter((item): item is YouTubeFormatInfo => Boolean(item))
    .filter((format) => format.vcodec && format.vcodec !== "none");

  if (videoCandidates.length === 0) {
    throw new YouTubeExtractionError("No downloadable video formats were returned by yt-dlp.");
  }

  videoCandidates.sort((a, b) => {
    const scoreA = (a.tbr ?? a.audioQualityScore ?? 0) + (a.ext === "mp4" ? 25 : 0) + (a.acodec && a.acodec !== "none" ? 15 : 0);
    const scoreB = (b.tbr ?? b.audioQualityScore ?? 0) + (b.ext === "mp4" ? 25 : 0) + (b.acodec && b.acodec !== "none" ? 15 : 0);
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return (b.filesize ?? 0) - (a.filesize ?? 0);
  });

  const best = videoCandidates[0];
  return {
    ...best,
    audioQualityScore: best.tbr ?? best.audioQualityScore ?? 0
  };
}

async function runYtDlpJsonDump(url: string): Promise<YtDlpDump> {
  const ytdlp = resolveBinaryCommand("yt-dlp");
  const baseArgs = ["--dump-single-json", "--no-playlist", url];

  try {
    const result = await runCommand(ytdlp, baseArgs);
    return JSON.parse(result.stdout) as YtDlpDump;
  } catch {
    const fallbackArgs = ["--dump-single-json", "--no-playlist", "--extractor-args", "youtube:player_client=android", url];
    const result = await runCommand(ytdlp, fallbackArgs);
    return JSON.parse(result.stdout) as YtDlpDump;
  }
}

export async function analyzeVideo(url: string, qualityMode: QualityMode = "source_fidelity"): Promise<YouTubeVideoInfo> {
  const parsed = await runYtDlpJsonDump(url);

  if (!parsed.id || !parsed.title || !parsed.webpage_url) {
    throw new YouTubeExtractionError("yt-dlp did not return the required video metadata.");
  }

  return {
    id: parsed.id,
    title: parsed.title,
    uploader: parsed.uploader,
    channel: parsed.channel,
    description: parsed.description,
    webpageUrl: parsed.webpage_url,
    thumbnail: parsed.thumbnail,
    duration: parsed.duration,
    selectedFormat: qualityMode === "video_mp4" ? selectBestVideoFormat(parsed.formats) : selectBestAudioFormat(parsed.formats)
  };
}

export interface DownloadAudioArgs {
  url: string;
  formatId: string;
  downloadSpeedProfile?: DownloadSpeedProfile;
  tempDir: string;
  expectedVideoId: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

function fragmentsForProfile(profile: DownloadSpeedProfile): number {
  if (profile === "safe") {
    return 1;
  }
  if (profile === "aggressive") {
    return 8;
  }
  return 4;
}

async function findDownloadedOutput(tempDir: string, expectedVideoId: string, preferredExt?: string): Promise<string> {
  const files = await readdir(tempDir);
  const prefix = `${expectedVideoId}.`;

  if (preferredExt) {
    const preferred = files.find((file) => file.startsWith(prefix) && file.toLowerCase().endsWith(`.${preferredExt.toLowerCase()}`));
    if (preferred) {
      return path.join(tempDir, preferred);
    }
  }

  const first = files.find((file) => file.startsWith(prefix));
  if (!first) {
    throw new YouTubeExtractionError("Unable to locate downloaded media file in temporary directory.");
  }

  return path.join(tempDir, first);
}

function dedupePlans(plans: DownloadPlan[]): DownloadPlan[] {
  const seen = new Set<string>();
  const out: DownloadPlan[] = [];

  for (const plan of plans) {
    const key = `${plan.format}::${plan.extractorArgs ?? ""}::${plan.fragments.join(",")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(plan);
  }

  return out;
}

function withBundledFfmpeg(args: string[]): string[] {
  const ffmpeg = resolveBinaryCommand("ffmpeg");
  if (ffmpeg && ffmpeg !== "ffmpeg") {
    return [...args, "--ffmpeg-location", ffmpeg];
  }
  return args;
}

function isNonRetryableDownloadError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const stderrValue = "stderr" in error ? (error as { stderr?: unknown }).stderr : undefined;
  if (typeof stderrValue !== "string" || stderrValue.trim().length === 0) {
    return false;
  }

  const stderr = stderrValue.toLowerCase();
  return (
    stderr.includes("this video is not available") ||
    stderr.includes("requested format is not available") ||
    stderr.includes("no video formats found") ||
    stderr.includes("unable to extract initial player response")
  );
}

async function executeDownloadPlans(
  ytdlp: string,
  plans: DownloadPlan[],
  baseArgs: string[],
  outputTemplate: string,
  url: string,
  signal: AbortSignal | undefined,
  onLog: ((line: string) => void) | undefined
): Promise<void> {
  const uniquePlans = dedupePlans(plans);
  let lastError: unknown;

  for (const plan of uniquePlans) {
    if (plan.notice) {
      onLog?.(plan.notice);
    }

    for (const fragments of plan.fragments) {
      const args = [...baseArgs, "-f", plan.format];
      if (plan.extractorArgs) {
        args.push("--extractor-args", plan.extractorArgs);
      }
      args.push("-N", String(fragments), "-o", outputTemplate, url);

      try {
        await runCommand(ytdlp, args, {
          signal,
          onStdout: onLog,
          onStderr: onLog
        });
        return;
      } catch (error: unknown) {
        lastError = error;
        if (isNonRetryableDownloadError(error)) {
          break;
        }
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
}

export async function downloadAudio(args: DownloadAudioArgs): Promise<string> {
  const outputTemplate = path.join(args.tempDir, "%(id)s.%(ext)s");
  const ytdlp = resolveBinaryCommand("yt-dlp");
  const speedProfile = args.downloadSpeedProfile ?? "balanced";
  const initialFragments = fragmentsForProfile(speedProfile);
  const attempts = initialFragments > 1 ? [initialFragments, 1] : [1];
  const plans: DownloadPlan[] = [
    { format: args.formatId, fragments: attempts },
    {
      format: args.formatId,
      extractorArgs: "youtube:player_client=android",
      fragments: [1],
      notice: "Download fallback: retrying selected format with alternate YouTube client."
    },
    {
      format: "bestaudio/b",
      extractorArgs: "youtube:player_client=android",
      fragments: [1],
      notice: "Download fallback: retrying with alternate YouTube client."
    },
    {
      format: "bestaudio/b",
      fragments: [1],
      notice: "Download fallback: requested audio format unavailable; retrying with best available audio."
    }
  ];

  await executeDownloadPlans(
    ytdlp,
    plans,
    ["--no-playlist"],
    outputTemplate,
    args.url,
    args.signal,
    args.onLog
  );

  return findDownloadedOutput(args.tempDir, args.expectedVideoId);
}

export interface DownloadVideoArgs {
  url: string;
  tempDir: string;
  expectedVideoId: string;
  downloadSpeedProfile?: DownloadSpeedProfile;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

export async function downloadVideoAsMp4(args: DownloadVideoArgs): Promise<string> {
  const outputTemplate = path.join(args.tempDir, "%(id)s.%(ext)s");
  const ytdlp = resolveBinaryCommand("yt-dlp");
  const speedProfile = args.downloadSpeedProfile ?? "balanced";
  const initialFragments = fragmentsForProfile(speedProfile);
  const attempts = initialFragments > 1 ? [initialFragments, 1] : [1];
  const plans: DownloadPlan[] = [
    { format: "bv*+ba/b", fragments: attempts },
    {
      format: "bv*+ba/b",
      extractorArgs: "youtube:player_client=android",
      fragments: [1],
      notice: "Video fallback: retrying with alternate YouTube client."
    },
    {
      format: "b[ext=mp4]/b",
      extractorArgs: "youtube:player_client=android",
      fragments: [1],
      notice: "Video fallback: retrying with MP4-priority format selection."
    },
    {
      format: "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      fragments: [1],
      notice: "Video fallback: retrying with web extraction path."
    }
  ];

  await executeDownloadPlans(
    ytdlp,
    plans,
    withBundledFfmpeg(["--no-playlist", "--merge-output-format", "mp4", "--remux-video", "mp4"]),
    outputTemplate,
    args.url,
    args.signal,
    args.onLog
  );

  const outputPath = await findDownloadedOutput(args.tempDir, args.expectedVideoId, "mp4");
  if (path.extname(outputPath).toLowerCase() !== ".mp4") {
    throw new YouTubeExtractionError("Failed to produce MP4 output for video mode.");
  }
  return outputPath;
}
