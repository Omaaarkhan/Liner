import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractionJobRecord } from "@audio-ripper/shared";

const MAX_JOBS = 200;
const MAX_PERSISTED_LOG_LINES = 100;
const WRITE_DELAY_MS = 500;

/**
 * Keeps job history in memory and writes it to disk on a short debounce,
 * so a burst of status changes during a download costs one write, not one each.
 */
export class HistoryStore {
  private readonly filePath: string;
  private records: ExtractionJobRecord[] | undefined;
  private writeTimer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, "history.json");
  }

  async list(): Promise<ExtractionJobRecord[]> {
    if (!this.records) {
      try {
        const raw = await readFile(this.filePath, "utf8");
        this.records = JSON.parse(raw) as ExtractionJobRecord[];
      } catch {
        this.records = [];
      }
    }
    return this.records;
  }

  async upsert(job: ExtractionJobRecord): Promise<void> {
    const existing = await this.list();
    this.records = [job, ...existing.filter((item) => item.jobId !== job.jobId)].slice(0, MAX_JOBS);
    this.scheduleWrite();
  }

  async delete(jobId: string): Promise<void> {
    const existing = await this.list();
    this.records = existing.filter((item) => item.jobId !== jobId);
    this.scheduleWrite();
  }

  async clear(): Promise<void> {
    this.records = [];
    this.scheduleWrite();
  }

  /** Writes any pending changes now. Call before the app quits. */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
      this.writing = this.writing.then(() => this.writeAll());
    }
    await this.writing;
  }

  private scheduleWrite(): void {
    if (this.writeTimer) {
      return;
    }
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      this.writing = this.writing.then(() => this.writeAll()).catch(() => undefined);
    }, WRITE_DELAY_MS);
  }

  private async writeAll(): Promise<void> {
    const compact = (this.records ?? []).map(toPersisted);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    // Write to a temp file and rename so a crash mid-write never leaves broken JSON.
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(compact), "utf8");
    await rename(tempPath, this.filePath);
  }
}

/** Drops transient and bulky fields: live progress, old log lines, embedded artwork bytes. */
function toPersisted(job: ExtractionJobRecord): ExtractionJobRecord {
  const { progress: _progress, ...rest } = job;
  return {
    ...rest,
    logs: job.logs.slice(-MAX_PERSISTED_LOG_LINES),
    metadataCandidates: job.metadataCandidates?.map(({ coverArtDataUrl: _data, ...candidate }) => candidate)
  };
}
