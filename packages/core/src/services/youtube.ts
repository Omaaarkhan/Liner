import { readdir } from "node:fs/promises";
import path from "node:path";
import type { DownloadSpeedProfile, YouTubeFormatInfo, YouTubeVideoInfo } from "@audio-ripper/shared";
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

export async function analyzeVideo(url: string): Promise<YouTubeVideoInfo> {
  const result = await runCommand(resolveBinaryCommand("yt-dlp"), ["--dump-single-json", "--no-playlist", url]);
  const parsed = JSON.parse(result.stdout) as YtDlpDump;

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
    selectedFormat: selectBestAudioFormat(parsed.formats)
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

export async function downloadAudio(args: DownloadAudioArgs): Promise<string> {
  const outputTemplate = path.join(args.tempDir, "%(id)s.%(ext)s");
  const ytdlp = resolveBinaryCommand("yt-dlp");
  const speedProfile = args.downloadSpeedProfile ?? "balanced";
  const initialFragments = fragmentsForProfile(speedProfile);
  const attempts = initialFragments > 1 ? [initialFragments, 1] : [1];
  let lastError: unknown;

  for (let index = 0; index < attempts.length; index += 1) {
    const fragments = attempts[index];
    const currentArgs = [
      "--no-playlist",
      "-f",
      args.formatId,
      "-N",
      String(fragments),
      "-o",
      outputTemplate,
      args.url
    ];

    try {
      await runCommand(ytdlp, currentArgs, {
        signal: args.signal,
        onStdout: args.onLog,
        onStderr: args.onLog
      });
      lastError = undefined;
      break;
    } catch (error: unknown) {
      lastError = error;
      const hasFallback = index < attempts.length - 1;
      if (hasFallback) {
        args.onLog?.(`Download retry: switching to safer fragment mode (-N ${attempts[index + 1]}).`);
        continue;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  const files = await readdir(args.tempDir);
  const byVideoId = files.find((file) => file.startsWith(`${args.expectedVideoId}.`));
  if (!byVideoId) {
    throw new YouTubeExtractionError("Unable to locate downloaded audio file in temporary directory.");
  }

  return path.join(args.tempDir, byVideoId);
}
