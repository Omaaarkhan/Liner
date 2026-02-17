import { describe, expect, it } from "vitest";
import { parseYoutubeTitle } from "@audio-ripper/core";

describe("parseYoutubeTitle", () => {
  it("extracts artist and title from hyphen format", () => {
    const parsed = parseYoutubeTitle("Daft Punk - One More Time (Official Video)");
    expect(parsed.artistHint).toBe("Daft Punk");
    expect(parsed.title).toBe("One More Time");
  });

  it("falls back to raw title when separator is absent", () => {
    const parsed = parseYoutubeTitle("Unstructured song title [Lyrics]");
    expect(parsed.artistHint).toBeUndefined();
    expect(parsed.title).toBe("Unstructured song title");
  });
});
