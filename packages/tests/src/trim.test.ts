import { describe, expect, it } from "vitest";
import { normalizeTrimRange, pickPreviewFormat, trimArgs } from "@audio-ripper/core";

describe("normalizeTrimRange", () => {
  it("clamps the range to the file and rounds to milliseconds", () => {
    expect(normalizeTrimRange({ start: -2, end: 61.23456 }, 60)).toEqual({ start: 0, end: 60 });
    expect(normalizeTrimRange({ start: 1.23456, end: 9.87654 }, 60)).toEqual({ start: 1.235, end: 9.877 });
  });

  it("rejects ranges that are too short or reversed", () => {
    expect(() => normalizeTrimRange({ start: 10, end: 10.2 }, 60)).toThrow(/at least/);
    expect(() => normalizeTrimRange({ start: 20, end: 10 }, 60)).toThrow(/at least/);
  });

  it("allows any end when the duration is unknown", () => {
    expect(normalizeTrimRange({ start: 5, end: 500 }, undefined)).toEqual({ start: 5, end: 500 });
  });
});

describe("trimArgs", () => {
  const range = { start: 3.2, end: 9.7 };

  it("copies audio and seeks after the input so WebM cuts land on the handle", () => {
    const args = trimArgs({ inputPath: "in.webm", outputDir: "/tmp", range, video: false }, "out.webm");
    expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
    expect(args).toEqual(expect.arrayContaining(["-c", "copy", "-t", "6.500"]));
    expect(args.at(-1)).toBe("out.webm");
  });

  it("re-encodes video so the clip starts on the chosen frame", () => {
    const args = trimArgs({ inputPath: "in.mp4", outputDir: "/tmp", range, video: true }, "out.mp4");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args).toEqual(expect.arrayContaining(["-c:v", "libx264", "-map", "0:a:0?"]));
  });
});

describe("pickPreviewFormat", () => {
  it("prefers an H.264 stream near 360p and skips audio-only and manifest formats", () => {
    const url = pickPreviewFormat([
      { url: "a", protocol: "https", vcodec: "none", height: 0 },
      { url: "b", protocol: "m3u8_native", vcodec: "avc1.4d401e", height: 360 },
      { url: "c", protocol: "https", vcodec: "vp9", height: 360 },
      { url: "d", protocol: "https", vcodec: "avc1.4d401e", height: 360 },
      { url: "e", protocol: "https", vcodec: "avc1.4d401f", height: 720 }
    ]);
    expect(url).toBe("d");
  });

  it("returns nothing when there is no video", () => {
    expect(pickPreviewFormat([{ url: "a", protocol: "https", vcodec: "none" }])).toBeUndefined();
  });
});
