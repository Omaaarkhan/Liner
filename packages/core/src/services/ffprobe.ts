import type { ProbeAudioInfo } from "@audio-ripper/shared";
import { runCommand } from "../utils/process.js";
import { resolveBinaryCommand } from "./binary-paths.js";

interface FFProbeJson {
  streams?: Array<{
    codec_name?: string;
    channels?: number;
    sample_rate?: string;
    bit_rate?: string;
  }>;
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
  };
}

export async function probeAudio(filePath: string): Promise<ProbeAudioInfo> {
  const ffprobe = resolveBinaryCommand("ffprobe");
  const result = await runCommand(ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath
  ]);

  const parsed = JSON.parse(result.stdout) as FFProbeJson;
  const firstAudio = parsed.streams?.[0];

  return {
    codec: firstAudio?.codec_name,
    container: parsed.format?.format_name,
    bitrate: Number(firstAudio?.bit_rate ?? parsed.format?.bit_rate) || undefined,
    duration: Number(parsed.format?.duration) || undefined,
    sampleRate: Number(firstAudio?.sample_rate) || undefined,
    channels: firstAudio?.channels
  };
}
