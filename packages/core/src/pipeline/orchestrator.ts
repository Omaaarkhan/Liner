import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ChooseMetadataInput,
  CreateJobInput,
  ExtractionJobRecord,
  ExtractionWarning,
  JobEvent,
  MetadataCandidate,
  PreflightReport,
  ResolveCandidatesInput,
  ResolveCandidatesOutput,
  Settings,
  TrackMetadata
} from "@audio-ripper/shared";
import { probeAudio } from "../services/ffprobe.js";
import { HistoryStore } from "../services/history-store.js";
import { moveIntoLibrary } from "../services/library.js";
import { resolveCandidates, resolveCandidatesFromVideo } from "../services/metadata.js";
import { DEFAULT_SETTINGS, SettingsStore } from "../services/settings-store.js";
import { applyTags } from "../services/tagging.js";
import { runPreflight } from "../services/binaries.js";
import { analyzeVideo, downloadAudio } from "../services/youtube.js";
import { ensureDir } from "../utils/fs.js";

interface PendingChoiceContext {
  tempDir: string;
  downloadedAudioPath: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface DownloadOrchestratorOptions {
  appDataDir: string;
}

export class DownloadOrchestrator extends EventEmitter {
  private readonly jobs = new Map<string, ExtractionJobRecord>();
  private readonly pendingChoices = new Map<string, PendingChoiceContext>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly settingsStore: SettingsStore;
  private readonly historyStore: HistoryStore;
  private settings: Settings = DEFAULT_SETTINGS;
  private initialized = false;
  private preflightReady = false;
  private preflightPromise: Promise<PreflightReport> | undefined;

  constructor(options: DownloadOrchestratorOptions) {
    super();
    this.settingsStore = new SettingsStore(options.appDataDir);
    this.historyStore = new HistoryStore(options.appDataDir);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.settings = await this.settingsStore.load();
    const history = await this.historyStore.list();
    for (const item of history) {
      this.jobs.set(item.jobId, item);
    }
    this.initialized = true;
    this.schedulePreflight();
  }

  getSettings(): Settings {
    return this.settings;
  }

  async updateSettings(next: Settings): Promise<void> {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...next
    };
    await this.settingsStore.save(this.settings);
  }

  listJobs(): ExtractionJobRecord[] {
    return Array.from(this.jobs.values()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async resolveMetadataCandidates(input: ResolveCandidatesInput): Promise<ResolveCandidatesOutput> {
    return resolveCandidates(input);
  }

  private schedulePreflight(): void {
    if (this.preflightReady || this.preflightPromise) {
      return;
    }

    this.preflightPromise = runPreflight()
      .then((report) => {
        if (report.allReady) {
          this.preflightReady = true;
        }
        return report;
      })
      .catch((error: unknown) => {
        this.preflightPromise = undefined;
        throw error;
      });
  }

  private async ensurePreflightReady(): Promise<void> {
    if (this.preflightReady) {
      return;
    }

    this.schedulePreflight();
    const pending = this.preflightPromise;
    if (!pending) {
      throw new Error("Binary preflight failed to start.");
    }

    const preflight = await pending;
    if (preflight.allReady) {
      this.preflightReady = true;
      this.preflightPromise = undefined;
      return;
    }

    this.preflightPromise = undefined;
    const missing = preflight.binaries.filter((item) => !item.available).map((item) => item.name).join(", ");
    throw new Error(`Required binaries are missing: ${missing}. Install with: brew install yt-dlp ffmpeg`);
  }

  private async persistAndEmit(job: ExtractionJobRecord): Promise<void> {
    this.jobs.set(job.jobId, job);
    await this.historyStore.upsert(job);
    const event: JobEvent = {
      type: "job-status",
      job
    };
    this.emit("event", event);
  }

  private appendLog(jobId: string, line: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    for (const segment of line.split("\n")) {
      const trimmed = segment.trim();
      if (!trimmed) {
        continue;
      }
      job.logs = [...job.logs.slice(-249), `[${new Date().toLocaleTimeString()}] ${trimmed}`];
      const event: JobEvent = {
        type: "job-log",
        jobId,
        line: trimmed,
        timestamp: nowIso()
      };
      this.emit("event", event);
    }
  }

  private async updateJob(jobId: string, patch: Partial<ExtractionJobRecord>): Promise<ExtractionJobRecord> {
    const previous = this.jobs.get(jobId);
    if (!previous) {
      throw new Error(`Job ${jobId} not found`);
    }

    const merged: ExtractionJobRecord = {
      ...previous,
      ...patch,
      updatedAt: nowIso()
    };

    await this.persistAndEmit(merged);
    return merged;
  }

  async createJob(input: CreateJobInput): Promise<ExtractionJobRecord> {
    await this.initialize();

    const jobId = randomUUID();
    const createdAt = nowIso();
    const request = {
      ...input,
      outputRoot: input.outputRoot || this.settings.outputRoot,
      qualityMode: input.qualityMode || this.settings.qualityMode,
      embedArtwork: input.embedArtwork ?? this.settings.embedArtwork,
      downloadSpeedProfile: input.downloadSpeedProfile || this.settings.downloadSpeedProfile || "balanced"
    };

    const job: ExtractionJobRecord = {
      jobId,
      request,
      status: "queued",
      warnings: [],
      logs: [],
      createdAt,
      updatedAt: createdAt
    };

    await this.persistAndEmit(job);

    void this.runJob(jobId).catch(async (error: unknown) => {
      if (!this.jobs.has(jobId)) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown failure";
      this.appendLog(jobId, `ERROR: ${message}`);

      try {
        await this.updateJob(jobId, {
          status: "failed",
          error: message
        });
      } catch {
        // Job might have been deleted from history while the task was stopping.
      }
    });

    return job;
  }

  async cancelJob(jobId: string): Promise<ExtractionJobRecord | undefined> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return undefined;
    }

    const cancellableStatuses = new Set([
      "queued",
      "analyzing",
      "downloading",
      "resolving_metadata",
      "awaiting_user_choice",
      "tagging"
    ]);

    if (!cancellableStatuses.has(existing.status)) {
      return existing;
    }

    const controller = this.controllers.get(jobId);
    if (controller) {
      controller.abort();
      this.controllers.delete(jobId);
    }

    if (this.pendingChoices.has(jobId)) {
      const pending = this.pendingChoices.get(jobId);
      this.pendingChoices.delete(jobId);
      if (pending) {
        await rm(pending.tempDir, { recursive: true, force: true });
      }
    }

    return this.updateJob(jobId, { status: "cancelled" });
  }

  async deleteJob(jobId: string): Promise<boolean> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return false;
    }

    if (this.controllers.has(jobId) || this.pendingChoices.has(jobId)) {
      await this.cancelJob(jobId);
    }

    this.jobs.delete(jobId);
    this.controllers.delete(jobId);

    const pending = this.pendingChoices.get(jobId);
    this.pendingChoices.delete(jobId);
    if (pending) {
      await rm(pending.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }

    await this.historyStore.delete(jobId);
    return true;
  }

  async clearHistory(): Promise<void> {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();

    for (const pending of this.pendingChoices.values()) {
      await rm(pending.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
    this.pendingChoices.clear();

    this.jobs.clear();
    await this.historyStore.clear();
  }

  async chooseMetadata(input: ChooseMetadataInput): Promise<ExtractionJobRecord> {
    const pending = this.pendingChoices.get(input.jobId);
    if (pending) {
      this.pendingChoices.delete(input.jobId);
      await this.updateJob(input.jobId, {
        status: "tagging",
        selectedMetadata: input.candidate.metadata
      });

      return this.finalizeJob(input.jobId, pending.tempDir, pending.downloadedAudioPath, input.candidate);
    }

    const existing = this.jobs.get(input.jobId);
    if (!existing) {
      throw new Error("Job not found.");
    }
    if (existing.status !== "completed" || !existing.outputPath) {
      throw new Error("No metadata selection is pending for this job.");
    }

    await this.updateJob(input.jobId, {
      status: "tagging",
      selectedMetadata: input.candidate.metadata
    });

    return this.retagCompletedJob(input.jobId, input.candidate);
  }

  private async runJob(jobId: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    let tempDir: string | undefined;

    try {
      await this.updateJob(jobId, { status: "analyzing" });

      await this.ensurePreflightReady();

      const existing = this.jobs.get(jobId);
      if (!existing) {
        throw new Error("Job disappeared from queue.");
      }

      const videoInfo = await analyzeVideo(existing.request.url);
      await this.updateJob(jobId, {
        status: "downloading",
        videoInfo
      });

      tempDir = await mkdtemp(path.join(os.tmpdir(), "audio-ripper-"));
      const downloadedAudioPath = await downloadAudio({
        url: existing.request.url,
        formatId: videoInfo.selectedFormat.formatId,
        downloadSpeedProfile: existing.request.downloadSpeedProfile || "balanced",
        tempDir,
        expectedVideoId: videoInfo.id,
        signal: controller.signal,
        onLog: (line) => this.appendLog(jobId, line)
      });

      const probeInfo = await probeAudio(downloadedAudioPath);

      await this.updateJob(jobId, {
        status: "resolving_metadata",
        probeInfo
      });

      const metadataResolution = await resolveCandidatesFromVideo(videoInfo);
      const bestCandidate = metadataResolution.autoSelected;

      await this.updateJob(jobId, {
        metadataCandidates: metadataResolution.candidates
      });

      if (!bestCandidate || bestCandidate.score < this.settings.metadataAutoSelectThreshold) {
        await this.updateJob(jobId, {
          status: "awaiting_user_choice"
        });

        this.pendingChoices.set(jobId, {
          tempDir,
          downloadedAudioPath
        });
        this.controllers.delete(jobId);
        tempDir = undefined;
        return;
      }

      await this.updateJob(jobId, {
        status: "tagging",
        selectedMetadata: bestCandidate.metadata
      });

      await this.finalizeJob(jobId, tempDir, downloadedAudioPath, bestCandidate);
      tempDir = undefined;
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private async finalizeJob(
    jobId: string,
    tempDir: string,
    downloadedAudioPath: string,
    selectedCandidate: MetadataCandidate
  ): Promise<ExtractionJobRecord> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error("Job not found during finalize.");
    }

    const warnings: ExtractionWarning[] = [...job.warnings];
    const metadata: TrackMetadata = selectedCandidate.metadata;

    await ensureDir(job.request.outputRoot);

    const taggingResult = await applyTags({
      inputPath: downloadedAudioPath,
      outputDir: tempDir,
      metadata,
      qualityMode: job.request.qualityMode,
      embedArtwork: job.request.embedArtwork,
      coverArtUrl: selectedCandidate.coverArtUrl,
      coverArtDataUrl: selectedCandidate.coverArtDataUrl,
      signal: this.controllers.get(jobId)?.signal,
      onLog: (line) => this.appendLog(jobId, line)
    });

    warnings.push(...taggingResult.warnings);

    const finalOutputPath = await moveIntoLibrary({
      stagedFilePath: taggingResult.outputPath,
      outputRoot: job.request.outputRoot,
      metadata
    });

    if (taggingResult.sidecarCoverPath) {
      const coverTarget = path.join(path.dirname(finalOutputPath), "cover.jpg");
      try {
        await stat(coverTarget);
      } catch {
        await rename(taggingResult.sidecarCoverPath, coverTarget).catch(() => undefined);
      }
    }

    await rm(tempDir, { recursive: true, force: true });
    this.controllers.delete(jobId);

    return this.updateJob(jobId, {
      status: "completed",
      outputPath: finalOutputPath,
      warnings,
      selectedMetadata: metadata
    });
  }

  private async retagCompletedJob(jobId: string, selectedCandidate: MetadataCandidate): Promise<ExtractionJobRecord> {
    const job = this.jobs.get(jobId);
    if (!job || !job.outputPath) {
      throw new Error("Job output not found during re-tagging.");
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "audio-ripper-retag-"));
    const warnings: ExtractionWarning[] = [...job.warnings];
    const metadata: TrackMetadata = selectedCandidate.metadata;
    const previousOutputPath = job.outputPath;

    try {
      const taggingResult = await applyTags({
        inputPath: previousOutputPath,
        outputDir: tempDir,
        metadata,
        qualityMode: job.request.qualityMode,
        embedArtwork: job.request.embedArtwork,
        coverArtUrl: selectedCandidate.coverArtUrl,
        coverArtDataUrl: selectedCandidate.coverArtDataUrl,
        signal: this.controllers.get(jobId)?.signal,
        onLog: (line) => this.appendLog(jobId, line)
      });

      warnings.push(...taggingResult.warnings);

      const finalOutputPath = await moveIntoLibrary({
        stagedFilePath: taggingResult.outputPath,
        outputRoot: job.request.outputRoot,
        metadata
      });

      if (taggingResult.sidecarCoverPath) {
        const coverTarget = path.join(path.dirname(finalOutputPath), "cover.jpg");
        try {
          await stat(coverTarget);
        } catch {
          await rename(taggingResult.sidecarCoverPath, coverTarget).catch(() => undefined);
        }
      }

      if (previousOutputPath !== finalOutputPath) {
        await rm(previousOutputPath, { force: true }).catch(() => undefined);
      }

      return this.updateJob(jobId, {
        status: "completed",
        outputPath: finalOutputPath,
        warnings,
        selectedMetadata: metadata
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
