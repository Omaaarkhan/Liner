import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareYtDlpVersions, HistoryStore, parseProgressLine, ytDlpAssetName } from "@audio-ripper/core";
import type { ExtractionJobRecord } from "@audio-ripper/shared";

describe("parseProgressLine", () => {
  it("reads bytes, total, eta and speed from the progress template", () => {
    const progress = parseProgressLine("yar-progress 5242880 10485760 NA 8 655360.5");
    expect(progress).toEqual({
      fraction: 0.5,
      downloadedBytes: 5242880,
      totalBytes: 10485760,
      etaSeconds: 8,
      speedBytesPerSecond: 655360.5
    });
  });

  it("falls back to the estimated total when the exact size is unknown", () => {
    expect(parseProgressLine("yar-progress 100 NA 400 NA NA")?.fraction).toBe(0.25);
  });

  it("ignores ordinary log lines", () => {
    expect(parseProgressLine("[youtube] abc: Downloading webpage")).toBeUndefined();
  });
});

describe("compareYtDlpVersions", () => {
  it("orders date versions including hotfix suffixes", () => {
    expect(compareYtDlpVersions("2026.08.19", "2026.02.04")).toBeGreaterThan(0);
    expect(compareYtDlpVersions("2026.08.19.1", "2026.08.19")).toBeGreaterThan(0);
    expect(compareYtDlpVersions("2026.08.19", "2026.08.19")).toBe(0);
  });
});

describe("ytDlpAssetName", () => {
  it("uses the fast-starting folder builds on macOS and Windows", () => {
    expect(ytDlpAssetName("darwin", "arm64").asset).toBe("yt-dlp_macos.zip");
    expect(ytDlpAssetName("win32", "x64")).toMatchObject({ asset: "yt-dlp_win.zip", executable: "yt-dlp.exe" });
    expect(ytDlpAssetName("win32", "arm64").asset).toBe("yt-dlp_win_arm64.zip");
  });
});

describe("HistoryStore", () => {
  it("writes once after a burst of updates and drops bulky fields", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "history-test-"));
    const store = new HistoryStore(dir);
    const job: ExtractionJobRecord = {
      jobId: "a",
      status: "completed",
      warnings: [],
      logs: Array.from({ length: 300 }, (_, i) => `line ${i}`),
      progress: { fraction: 1 },
      metadataCandidates: [
        { source: "youtube", score: 0.5, coverArtDataUrl: "data:image/png;base64,AAAA", metadata: { title: "t", artist: "a", album: "b" } }
      ],
      request: { url: "https://example.com", outputRoot: dir, qualityMode: "source_fidelity", embedArtwork: true },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    for (let i = 0; i < 20; i += 1) {
      await store.upsert({ ...job, updatedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` });
    }
    await store.flush();

    const saved = JSON.parse(await readFile(path.join(dir, "history.json"), "utf8")) as ExtractionJobRecord[];
    expect(saved).toHaveLength(1);
    expect(saved[0].logs).toHaveLength(100);
    expect(saved[0].progress).toBeUndefined();
    expect(saved[0].metadataCandidates?.[0].coverArtDataUrl).toBeUndefined();
  });
});
