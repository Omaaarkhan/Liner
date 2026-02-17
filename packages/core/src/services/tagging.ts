import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractionWarning, QualityMode, TrackMetadata } from "@audio-ripper/shared";
import { runCommand } from "../utils/process.js";
import { resolveBinaryCommand } from "./binary-paths.js";

const EMBED_SUPPORTED_EXTENSIONS = new Set([".mp3", ".m4a", ".mp4"]);

export interface ApplyTagsInput {
  inputPath: string;
  outputDir: string;
  metadata: TrackMetadata;
  qualityMode: QualityMode;
  embedArtwork: boolean;
  coverArtUrl?: string;
  coverArtDataUrl?: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

export interface ApplyTagsOutput {
  outputPath: string;
  warnings: ExtractionWarning[];
  sidecarCoverPath?: string;
}

async function downloadCoverArt(url: string, outputPath: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return false;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(outputPath, bytes);
    return true;
  } catch {
    return false;
  }
}

async function writeCoverArtDataUrl(dataUrl: string, outputPath: string): Promise<boolean> {
  try {
    const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match?.[1]) {
      return false;
    }

    const bytes = Buffer.from(match[1], "base64");
    if (bytes.length === 0) {
      return false;
    }

    await writeFile(outputPath, bytes);
    return true;
  } catch {
    return false;
  }
}

function metadataArgs(metadata: TrackMetadata): string[] {
  const args = [
    "-metadata",
    `title=${metadata.title}`,
    "-metadata",
    `artist=${metadata.artist}`,
    "-metadata",
    `album=${metadata.album}`
  ];

  if (metadata.albumArtist) {
    args.push("-metadata", `album_artist=${metadata.albumArtist}`);
  }
  if (metadata.trackNumber) {
    args.push("-metadata", `track=${metadata.trackNumber}`);
  }
  if (metadata.discNumber) {
    args.push("-metadata", `disc=${metadata.discNumber}`);
  }
  if (metadata.year) {
    args.push("-metadata", `date=${metadata.year}`);
  }
  if (metadata.genre) {
    args.push("-metadata", `genre=${metadata.genre}`);
  }
  if (metadata.isrc) {
    args.push("-metadata", `isrc=${metadata.isrc}`);
  }

  return args;
}

export async function applyTags(input: ApplyTagsInput): Promise<ApplyTagsOutput> {
  const warnings: ExtractionWarning[] = [];
  const sourceExt = path.extname(input.inputPath).toLowerCase();
  const outputExt = input.qualityMode === "mp3_320_export" ? ".mp3" : sourceExt || ".m4a";
  const outputPath = path.join(input.outputDir, `tagged${outputExt}`);
  const artPath = path.join(input.outputDir, "cover.jpg");
  let sidecarCoverPath: string | undefined;

  const args = ["-y", "-i", input.inputPath];
  const tagArgs = metadataArgs(input.metadata);

  let includeCover = false;
  if (input.embedArtwork && (input.coverArtDataUrl || input.coverArtUrl)) {
    const canEmbedInContainer = EMBED_SUPPORTED_EXTENSIONS.has(outputExt);
    const artworkPrepared = input.coverArtDataUrl
      ? await writeCoverArtDataUrl(input.coverArtDataUrl, artPath)
      : input.coverArtUrl
        ? await downloadCoverArt(input.coverArtUrl, artPath)
        : false;

    if (canEmbedInContainer) {
      if (artworkPrepared) {
        includeCover = true;
      } else {
        warnings.push({
          code: "cover_download_failed",
          message: "Cover art was provided but processing the image failed."
        });
      }
    } else {
      warnings.push({
        code: "cover_embed_not_supported",
        message: `Embedded artwork is not supported for ${outputExt} output. Saved cover.jpg sidecar in the staging folder.`
      });
      if (artworkPrepared) {
        sidecarCoverPath = artPath;
      } else {
        warnings.push({
          code: "cover_download_failed",
          message: "Cover art was provided but processing the image failed."
        });
      }
    }
  }

  if (input.qualityMode === "mp3_320_export") {
    if (includeCover) {
      args.push("-i", artPath, "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-b:a", "320k", "-c:v", "mjpeg");
    } else {
      args.push("-map", "0:a", "-c:a", "libmp3lame", "-b:a", "320k");
    }
  } else {
    if (includeCover && outputExt === ".mp3") {
      args.push("-i", artPath, "-map", "0:a", "-map", "1:v", "-c:a", "copy", "-c:v", "mjpeg", "-id3v2_version", "3");
      args.push("-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
    } else if (includeCover && (outputExt === ".m4a" || outputExt === ".mp4")) {
      args.push("-i", artPath, "-map", "0:a", "-map", "1:v", "-c:a", "copy", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
    } else {
      args.push("-map", "0:a", "-c:a", "copy");
    }
  }

  args.push(...tagArgs, outputPath);
  const ffmpeg = resolveBinaryCommand("ffmpeg");

  await runCommand(ffmpeg, args, {
    signal: input.signal,
    onStdout: input.onLog,
    onStderr: input.onLog
  });

  return { outputPath, warnings, sidecarCoverPath };
}
