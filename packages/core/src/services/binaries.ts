import type { BinaryStatus, PreflightReport } from "@audio-ripper/shared";
import { runCommand } from "../utils/process.js";
import { getBundledBinaryPath, resolveBinaryCommand } from "./binary-paths.js";

function installHint(): string {
  if (process.platform === "darwin") {
    return "Bundled tools are missing. Reinstall the app, or run: brew install yt-dlp ffmpeg";
  }
  if (process.platform === "win32") {
    return "Bundled tools are missing. Reinstall the app, or run: winget install yt-dlp.yt-dlp Gyan.FFmpeg";
  }
  return "Bundled tools are missing. Reinstall the app, or install yt-dlp and ffmpeg with your package manager.";
}

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
      installHint: installHint()
    };
  }
}

export async function runPreflight(): Promise<PreflightReport> {
  const binaries = await Promise.all([
    getBinaryVersion("ffmpeg"),
    getBinaryVersion("yt-dlp")
  ]);

  return {
    binaries,
    allReady: binaries.every((item) => item.available)
  };
}
