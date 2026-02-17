import { accessSync, constants } from "node:fs";
import type { BinaryStatus } from "@audio-ripper/shared";

const ENV_FOR_BINARY: Record<BinaryStatus["name"], string> = {
  ffmpeg: "YAR_FFMPEG_PATH",
  ffprobe: "YAR_FFPROBE_PATH",
  "yt-dlp": "YAR_YTDLP_PATH"
};

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBinaryCommand(name: BinaryStatus["name"]): string {
  const envName = ENV_FOR_BINARY[name];
  const candidate = process.env[envName];

  if (candidate && isExecutableFile(candidate)) {
    return candidate;
  }

  return name;
}

export function getBundledBinaryPath(name: BinaryStatus["name"]): string | undefined {
  const envName = ENV_FOR_BINARY[name];
  return process.env[envName];
}
