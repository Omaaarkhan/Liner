import { chmod, copyFile, mkdir, rename, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const platformArch = `${process.platform}-${process.arch}`;
const targetDir = path.join(desktopRoot, "vendor", "bin", platformArch);

const binaryNames = {
  ffmpeg: process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ffprobe: process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  ytdlp: process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
};

const require = createRequire(import.meta.url);
const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

function ytdlpDownloadUrl() {
  if (process.platform === "darwin") {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
  }

  if (process.platform === "linux" && process.arch === "arm64") {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64";
  }

  if (process.platform === "win32") {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
  }

  throw new Error(`Unsupported platform for yt-dlp bundling: ${process.platform}-${process.arch}`);
}

async function ensureExecutable(filePath) {
  if (process.platform !== "win32") {
    await chmod(filePath, 0o755);
  }
}

async function copyBundledBinary(sourcePath, destinationPath) {
  await copyFile(sourcePath, destinationPath);
  await ensureExecutable(destinationPath);
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const tempPath = `${destinationPath}.tmp`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
  await rename(tempPath, destinationPath);
}

async function run() {
  await mkdir(targetDir, { recursive: true });

  const ffmpegOut = path.join(targetDir, binaryNames.ffmpeg);
  const ffprobeOut = path.join(targetDir, binaryNames.ffprobe);
  const ytdlpOut = path.join(targetDir, binaryNames.ytdlp);

  await copyBundledBinary(ffmpegStatic, ffmpegOut);
  await copyBundledBinary(ffprobeStatic.path, ffprobeOut);

  if (!(await fileExists(ytdlpOut))) {
    const url = ytdlpDownloadUrl();
    await downloadFile(url, ytdlpOut);
  }
  await ensureExecutable(ytdlpOut);

  console.log(`[prepare-binaries] Ready: ${platformArch}`);
  console.log(`[prepare-binaries] ffmpeg: ${ffmpegOut}`);
  console.log(`[prepare-binaries] ffprobe: ${ffprobeOut}`);
  console.log(`[prepare-binaries] yt-dlp: ${ytdlpOut}`);
}

run().catch((error) => {
  console.error("[prepare-binaries] Failed", error);
  process.exitCode = 1;
});
