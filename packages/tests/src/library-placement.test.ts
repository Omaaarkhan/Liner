import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveIntoLibrary } from "@audio-ripper/core";

const metadata = {
  title: "Track:Title?",
  artist: "Artist/Name",
  album: "Album<Name>",
  trackNumber: 1
};

describe("moveIntoLibrary", () => {
  it("sanitizes folders and file names", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "library-test-"));

    try {
      const staged = path.join(tempRoot, "input.m4a");
      await writeFile(staged, "audio-data", "utf8");

      const output = await moveIntoLibrary({
        stagedFilePath: staged,
        outputRoot: tempRoot,
        metadata
      });

      expect(output).toContain(path.join("ArtistName", "AlbumName", "01 - TrackTitle.m4a"));
      const content = await readFile(output, "utf8");
      expect(content).toBe("audio-data");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("appends collision suffix for duplicate tracks", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "library-test-"));

    try {
      const first = path.join(tempRoot, "one.mp3");
      const second = path.join(tempRoot, "two.mp3");
      await writeFile(first, "first", "utf8");
      await writeFile(second, "second", "utf8");

      const firstOutput = await moveIntoLibrary({
        stagedFilePath: first,
        outputRoot: tempRoot,
        metadata
      });
      const secondOutput = await moveIntoLibrary({
        stagedFilePath: second,
        outputRoot: tempRoot,
        metadata
      });

      expect(firstOutput).toContain("01 - TrackTitle.mp3");
      expect(secondOutput).toContain("01 - TrackTitle (2).mp3");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
