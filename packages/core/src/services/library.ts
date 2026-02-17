import { rename } from "node:fs/promises";
import path from "node:path";
import type { TrackMetadata } from "@audio-ripper/shared";
import { ensureDir, sanitizePathSegment, uniqueFilePath, withTrackNumber } from "../utils/fs.js";

export interface LibraryPlacementInput {
  stagedFilePath: string;
  outputRoot: string;
  metadata: TrackMetadata;
}

export interface VideoLibraryPlacementInput {
  stagedFilePath: string;
  outputRoot: string;
  title: string;
}

export async function moveIntoLibrary(input: LibraryPlacementInput): Promise<string> {
  const artist = sanitizePathSegment(input.metadata.artist, "Unknown Artist");
  const album = sanitizePathSegment(input.metadata.album, "Unknown Album");
  const trackBase = withTrackNumber(input.metadata.trackNumber, input.metadata.title || "Untitled");
  const ext = path.extname(input.stagedFilePath);

  const albumDir = path.join(input.outputRoot, artist, album);
  await ensureDir(albumDir);

  const desiredPath = path.join(albumDir, `${trackBase}${ext}`);
  const finalPath = await uniqueFilePath(desiredPath);

  await rename(input.stagedFilePath, finalPath);
  return finalPath;
}

export async function moveVideoIntoLibrary(input: VideoLibraryPlacementInput): Promise<string> {
  const safeTitle = sanitizePathSegment(input.title, "Untitled Video");
  const ext = path.extname(input.stagedFilePath).toLowerCase() || ".mp4";
  const videoDir = path.join(input.outputRoot, "Videos");
  await ensureDir(videoDir);

  const desiredPath = path.join(videoDir, `${safeTitle}${ext}`);
  const finalPath = await uniqueFilePath(desiredPath);

  await rename(input.stagedFilePath, finalPath);
  return finalPath;
}
