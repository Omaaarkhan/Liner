import { spawn } from "node:child_process";
import path from "node:path";
import type { TrimRange } from "@audio-ripper/shared";
import { CommandExecutionError, runCommand } from "../utils/process.js";
import { resolveBinaryCommand } from "./binary-paths.js";

/** Shortest clip the editor allows, so a cut always has something in it. */
export const MIN_TRIM_SECONDS = 0.5;

const WAVEFORM_SAMPLE_RATE = 4000;

export interface Waveform {
  duration: number;
  peaks: number[];
}

/**
 * Decodes the audio track to low-rate mono PCM and reduces it to one loudness
 * value per bucket. Raw output is collected as bytes, which runCommand cannot do.
 */
export async function readWaveform(inputPath: string, buckets = 800, signal?: AbortSignal): Promise<Waveform> {
  const ffmpeg = resolveBinaryCommand("ffmpeg");
  const args = ["-hide_banner", "-nostdin", "-i", inputPath, "-vn", "-ac", "1", "-ar", String(WAVEFORM_SAMPLE_RATE), "-f", "s16le", "-"];
  const child = spawn(ffmpeg, args, { signal, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  const chunks: Buffer[] = [];
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new CommandExecutionError(ffmpeg, args, stderr, code ?? 1))));
  });

  const pcm = Buffer.concat(chunks);
  const samples = Math.floor(pcm.length / 2);
  const duration = samples / WAVEFORM_SAMPLE_RATE;
  const count = Math.max(1, Math.min(buckets, samples));
  const peaks = new Array<number>(count).fill(0);

  for (let bucket = 0; bucket < count; bucket += 1) {
    const from = Math.floor((bucket * samples) / count);
    const to = Math.floor(((bucket + 1) * samples) / count);
    // Root mean square reads closer to perceived loudness than the raw peak.
    let sum = 0;
    for (let index = from; index < to; index += 1) {
      const value = pcm.readInt16LE(index * 2) / 32768;
      sum += value * value;
    }
    peaks[bucket] = to > from ? Math.sqrt(sum / (to - from)) : 0;
  }

  const loudest = Math.max(...peaks, 1e-6);
  return { duration, peaks: peaks.map((value) => Math.round((value / loudest) * 1000) / 1000) };
}

/** Clamps a requested range to the file and rounds it to milliseconds. */
export function normalizeTrimRange(range: TrimRange, duration: number | undefined): TrimRange {
  const limit = duration && Number.isFinite(duration) ? duration : Number.POSITIVE_INFINITY;
  const start = Math.max(0, Math.min(range.start, limit));
  const end = Math.max(0, Math.min(range.end, limit));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_TRIM_SECONDS) {
    throw new Error(`Pick a part that is at least ${MIN_TRIM_SECONDS} seconds long.`);
  }
  return { start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
}

export interface TrimMediaInput {
  inputPath: string;
  outputDir: string;
  range: TrimRange;
  video: boolean;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

/** ffmpeg arguments for cutting one range out of the input. Exported for tests. */
export function trimArgs(input: TrimMediaInput, outputPath: string): string[] {
  const start = input.range.start.toFixed(3);
  const length = (input.range.end - input.range.start).toFixed(3);
  const args = ["-hide_banner", "-nostdin", "-y"];

  if (input.video) {
    // Stream copy can only cut on keyframes, seconds away from the handles,
    // so the clip is re-encoded to start and end on the chosen frames.
    // Seeking before -i is fast and, when decoding, still frame accurate.
    args.push(
      "-ss", start, "-i", input.inputPath, "-t", length,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart"
    );
  } else {
    // Audio packets are a few milliseconds long, so copying keeps the source quality
    // and still lands on the handles. Seeking after -i matters here: before it, a
    // WebM copy snaps back to the previous cue point, which can be seconds early.
    args.push("-i", input.inputPath, "-ss", start, "-t", length, "-map", "0:a:0", "-c", "copy", "-avoid_negative_ts", "make_zero");
  }

  args.push(outputPath);
  return args;
}

/** Writes the chosen range of the input to a new file in outputDir and returns its path. */
export async function trimMedia(input: TrimMediaInput): Promise<string> {
  const ext = input.video ? ".mp4" : path.extname(input.inputPath) || ".m4a";
  const outputPath = path.join(input.outputDir, `trimmed${ext}`);
  const ffmpeg = resolveBinaryCommand("ffmpeg");

  await runCommand(ffmpeg, trimArgs(input, outputPath), {
    signal: input.signal,
    onStderr: (line) => {
      if (/error|invalid/i.test(line)) {
        input.onLog?.(line);
      }
    }
  });

  return outputPath;
}
