import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ToolUpdateStatus } from "@audio-ripper/shared";
import { runCommand } from "../utils/process.js";

const LATEST_RELEASE_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const POINTER_FILE = "current.json";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface Pointer {
  version: string;
  executable: string;
}

/**
 * The yt-dlp release asset for this machine. Folder ("onedir") builds are used
 * where they exist because they start in well under a second, while the
 * single-file builds unpack a Python runtime on every launch.
 */
export function ytDlpAssetName(platform = process.platform, arch = process.arch): { asset: string; executable: string; archive: boolean } {
  if (platform === "darwin") {
    return { asset: "yt-dlp_macos.zip", executable: "yt-dlp_macos", archive: true };
  }
  if (platform === "win32") {
    return {
      asset: arch === "arm64" ? "yt-dlp_win_arm64.zip" : "yt-dlp_win.zip",
      executable: "yt-dlp.exe",
      archive: true
    };
  }
  if (platform === "linux") {
    return { asset: arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux", executable: "yt-dlp", archive: false };
  }
  throw new Error(`No yt-dlp build is published for ${platform}-${arch}.`);
}

/** Compares yt-dlp date versions such as 2026.08.19 and 2026.08.19.1. */
export function compareYtDlpVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Returns the executable installed by a previous update, if it is still on disk. */
export async function readInstalledYtDlp(toolsDir: string): Promise<Pointer | undefined> {
  try {
    const pointer = JSON.parse(await readFile(path.join(toolsDir, POINTER_FILE), "utf8")) as Pointer;
    await stat(pointer.executable);
    return pointer;
  } catch {
    return undefined;
  }
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(destination));
}

export interface YtDlpUpdateOptions {
  /** Where updated copies live, for example <userData>/tools/yt-dlp. */
  toolsDir: string;
  /** Version of the yt-dlp currently in use. */
  currentVersion?: string;
}

/**
 * Downloads the latest yt-dlp release into toolsDir when it is newer than the
 * current one. YouTube changes often, so a stale yt-dlp is the most common
 * reason downloads start failing.
 */
export async function checkForYtDlpUpdate(options: YtDlpUpdateOptions): Promise<ToolUpdateStatus & { executable?: string }> {
  const response = await fetch(LATEST_RELEASE_URL, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) {
    return { updated: false, currentVersion: options.currentVersion, message: `Could not reach GitHub (${response.status}).` };
  }

  const release = (await response.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
  const latestVersion = release.tag_name;
  if (!latestVersion) {
    return { updated: false, currentVersion: options.currentVersion, message: "GitHub did not return a release." };
  }

  if (options.currentVersion && compareYtDlpVersions(latestVersion, options.currentVersion) <= 0) {
    return { updated: false, currentVersion: options.currentVersion, latestVersion, message: "yt-dlp is up to date." };
  }

  const target = ytDlpAssetName();
  const asset = release.assets?.find((item) => item.name === target.asset);
  if (!asset) {
    return { updated: false, currentVersion: options.currentVersion, latestVersion, message: `Release has no ${target.asset}.` };
  }

  const versionDir = path.join(options.toolsDir, latestVersion);
  await rm(versionDir, { recursive: true, force: true });
  await mkdir(versionDir, { recursive: true });

  const downloadPath = path.join(versionDir, target.archive ? target.asset : target.executable);
  await download(asset.browser_download_url, downloadPath);

  if (target.archive) {
    // bsdtar reads zip files and ships with both macOS and Windows 10+.
    await runCommand("tar", ["-xf", downloadPath, "-C", versionDir]);
    await rm(downloadPath, { force: true });
  }

  const executable = path.join(versionDir, target.executable);
  if (process.platform !== "win32") {
    await chmod(executable, 0o755);
  }

  const check = await runCommand(executable, ["--version"]);
  const installedVersion = check.stdout.trim();

  await writeFile(
    path.join(options.toolsDir, POINTER_FILE),
    JSON.stringify({ version: installedVersion, executable } satisfies Pointer),
    "utf8"
  );

  // Remove older downloaded versions.
  for (const entry of await readdir(options.toolsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== latestVersion) {
      await rm(path.join(options.toolsDir, entry.name), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { updated: true, currentVersion: installedVersion, latestVersion, executable, message: `Updated yt-dlp to ${installedVersion}.` };
}
