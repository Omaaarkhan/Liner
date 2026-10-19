import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Settings } from "@audio-ripper/shared";

export const DEFAULT_SETTINGS: Settings = {
  outputRoot: path.join(os.homedir(), "Music", "Liner"),
  qualityMode: "source_fidelity",
  embedArtwork: true,
  downloadSpeedProfile: "balanced",
  metadataAutoSelectThreshold: 0.86,
  filenameTemplate: "{trackNumber:02} - {title}",
  theme: "system"
};

export class SettingsStore {
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, "settings.json");
  }

  async load(): Promise<Settings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async save(settings: Settings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(settings, null, 2), "utf8");
  }
}
