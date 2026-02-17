import type { BinaryStatus, PreflightReport } from "@audio-ripper/shared";
import { runCommand } from "../utils/process.js";
import { getBundledBinaryPath, resolveBinaryCommand } from "./binary-paths.js";

const INSTALL_HINT = "Bundled binaries missing. Reinstall app or install manually: brew install yt-dlp ffmpeg";

async function getBinaryVersion(name: BinaryStatus["name"]): Promise<BinaryStatus> {
  try {
    const args = name === "yt-dlp" ? ["--version"] : ["-version"];
    const command = resolveBinaryCommand(name);
    const result = await runCommand(command, args);
    const firstLine = result.stdout.split("\n").find((line) => line.trim().length > 0);
    const bundled = getBundledBinaryPath(name);
    const isBundled = Boolean(bundled && command === bundled);
    const prefix = isBundled ? "bundled: " : "";

    return {
      name,
      available: true,
      version: `${prefix}${firstLine?.trim() ?? "unknown"}`
    };
  } catch {
    return {
      name,
      available: false,
      installHint: INSTALL_HINT
    };
  }
}

export async function runPreflight(): Promise<PreflightReport> {
  const binaries = await Promise.all([
    getBinaryVersion("ffmpeg"),
    getBinaryVersion("ffprobe"),
    getBinaryVersion("yt-dlp")
  ]);

  return {
    binaries,
    allReady: binaries.every((item) => item.available)
  };
}
