import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractionJobRecord } from "@audio-ripper/shared";

export class HistoryStore {
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, "history.json");
  }

  async list(): Promise<ExtractionJobRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as ExtractionJobRecord[];
    } catch {
      return [];
    }
  }

  async upsert(job: ExtractionJobRecord): Promise<void> {
    const existing = await this.list();
    const next = [job, ...existing.filter((item) => item.jobId !== job.jobId)].slice(0, 200);
    await this.writeAll(next);
  }

  async delete(jobId: string): Promise<void> {
    const existing = await this.list();
    const next = existing.filter((item) => item.jobId !== jobId);
    await this.writeAll(next);
  }

  async clear(): Promise<void> {
    await this.writeAll([]);
  }

  private async writeAll(records: ExtractionJobRecord[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(records, null, 2), "utf8");
  }
}
