// Prepares the ffmpeg and yt-dlp builds that get bundled with the app.
// Output: vendor/bin/<platform>-<arch>/ffmpeg[.exe] and vendor/bin/<platform>-<arch>/yt-dlp/<executable>
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const platformArch = `${process.platform}-${process.arch}`;
const targetDir = path.join(desktopRoot, "vendor", "bin", platformArch);
const isWindows = process.platform === "win32";

const require = createRequire(import.meta.url);
const ffmpegStatic = require("ffmpeg-static");

// Folder ("onedir") builds start in well under a second; the single-file
// builds unpack Python on every launch (about 3 s on an M-series Mac).
function ytDlpAsset() {
  const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
  if (process.platform === "darwin") {
    return { url: `${base}yt-dlp_macos.zip`, executable: "yt-dlp_macos", archive: true };
  }
  if (isWindows) {
    const name = process.arch === "arm64" ? "yt-dlp_win_arm64.zip" : "yt-dlp_win.zip";
    return { url: `${base}${name}`, executable: "yt-dlp.exe", archive: true };
  }
  if (process.platform === "linux") {
    const name = process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
    return { url: `${base}${name}`, executable: "yt-dlp", archive: false };
  }
  throw new Error(`Unsupported platform for yt-dlp bundling: ${platformArch}`);
}

async function exists(filePath) {
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

async function prepareFfmpeg() {
  if (!ffmpegStatic) {
    throw new Error(`ffmpeg-static has no build for ${platformArch}`);
  }
  const out = path.join(targetDir, isWindows ? "ffmpeg.exe" : "ffmpeg");
  await copyFile(ffmpegStatic, out);
  if (!isWindows) {
    await chmod(out, 0o755);
  }
  return out;
}

async function prepareYtDlp() {
  const asset = ytDlpAsset();
  const ytDir = path.join(targetDir, "yt-dlp");
  const executable = path.join(ytDir, asset.executable);
  if ((await exists(executable)) && !process.env.YAR_REFRESH_YTDLP) {
    return executable;
  }

  await rm(ytDir, { recursive: true, force: true });
  await mkdir(ytDir, { recursive: true });
  if (asset.archive) {
    const archivePath = path.join(ytDir, "download.zip");
    await downloadFile(asset.url, archivePath);
    // bsdtar extracts zip files on macOS and Windows 10+.
    execFileSync("tar", ["-xf", archivePath, "-C", ytDir], { stdio: "inherit" });
    await rm(archivePath, { force: true });
  } else {
    await downloadFile(asset.url, executable);
  }
  if (!isWindows) {
    await chmod(executable, 0o755);
  }
  return executable;
}

async function run() {
  await mkdir(targetDir, { recursive: true });
  // Older builds bundled an Intel-only ffprobe and a single-file yt-dlp here.
  await rm(path.join(targetDir, isWindows ? "ffprobe.exe" : "ffprobe"), { force: true });
  await rm(path.join(targetDir, isWindows ? "yt-dlp.exe" : "yt-dlp"), { force: true }).catch(() => undefined);

  const ffmpeg = await prepareFfmpeg();
  const ytdlp = await prepareYtDlp();
  const version = execFileSync(ytdlp, ["--version"]).toString().trim();

  console.log(`[prepare-binaries] Ready: ${platformArch}`);
  console.log(`[prepare-binaries] ffmpeg: ${ffmpeg}`);
  console.log(`[prepare-binaries] yt-dlp ${version}: ${ytdlp}`);
}

run().catch((error) => {
  console.error("[prepare-binaries] Failed", error);
  process.exitCode = 1;
});
