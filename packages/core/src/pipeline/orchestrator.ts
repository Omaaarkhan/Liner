import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ApplyTrimInput,
  ChooseMetadataInput,
  CreateJobInput,
  ExtractionJobRecord,
  ExtractionWarning,
  JobEvent,
  JobProgress,
  MetadataCandidate,
  PreflightReport,
  ResolveCandidatesInput,
  ResolveCandidatesOutput,
  Settings,
  ProbeAudioInfo,
  TrackMetadata,
  TrimSource,
  YouTubeVideoInfo
} from "@audio-ripper/shared";
import { HistoryStore } from "../services/history-store.js";
import { moveIntoLibrary, moveVideoIntoLibrary } from "../services/library.js";
import { resolveCandidates, resolveCandidatesFromVideo } from "../services/metadata.js";
import { DEFAULT_SETTINGS, SettingsStore } from "../services/settings-store.js";
import { applyTags } from "../services/tagging.js";
import { runPreflight } from "../services/binaries.js";
import { normalizeTrimRange, readPreviewUrl, readWaveform, trimMedia } from "../services/trim.js";
import { analyzeVideo, downloadAudio, downloadVideoAsMp4, parseProgressLine } from "../services/youtube.js";
import { ensureDir } from "../utils/fs.js";
import { CommandExecutionError } from "../utils/process.js";

interface PendingChoiceContext {
  tempDir: string;
  downloadedAudioPath: string;
}

interface PendingTrimContext {
  tempDir: string;
  downloadedPath: string;
  infoJsonPath?: string;
  waveform?: Promise<TrimSource>;
}

const LOG_FLUSH_MS = 200;
const PROGRESS_EMIT_MS = 150;
const FINISHED_STATUSES = new Set(["completed", "failed", "cancelled"]);

/** Audio details come straight from the format yt-dlp chose, so no separate probe is needed. */
function probeInfoFromFormat(video: YouTubeVideoInfo): ProbeAudioInfo {
  const format = video.selectedFormat;
  return {
    codec: format.acodec,
    container: format.ext,
    bitrate: format.abr ? Math.round(format.abr * 1000) : undefined,
    duration: video.duration,
    sampleRate: format.asr,
    channels: format.audioChannels
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  if (error instanceof CommandExecutionError) {
    const firstStderrLine = error.stderr
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (firstStderrLine) {
      return `${error.message}. ${firstStderrLine}`;
    }
  }

  return error instanceof Error ? error.message : "Unknown failure";
}

export interface DownloadOrchestratorOptions {
  appDataDir: string;
}

export class DownloadOrchestrator extends EventEmitter {
  private readonly jobs = new Map<string, ExtractionJobRecord>();
  private readonly pendingChoices = new Map<string, PendingChoiceContext>();
  private readonly pendingTrims = new Map<string, PendingTrimContext>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly settingsStore: SettingsStore;
  private readonly historyStore: HistoryStore;
  private settings: Settings = DEFAULT_SETTINGS;
  private initialized = false;
  private preflightReady = false;
  private preflightPromise: Promise<PreflightReport> | undefined;
  private lastPreflight: PreflightReport | undefined;
  private readonly pendingLogLines = new Map<string, string[]>();
  private logFlushTimer: NodeJS.Timeout | undefined;
  private readonly lastProgressEmit = new Map<string, number>();

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
      // The downloaded file waiting to be trimmed is only known to the session that made it.
      if (item.status === "awaiting_trim" || item.status === "trimming") {
        item.status = "cancelled";
        item.error = "Liner closed before the clip was trimmed.";
      }
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

  /** Tool availability, cached after the first check unless force is set. */
  async getPreflight(force = false): Promise<PreflightReport> {
    if (force) {
      this.preflightReady = false;
      this.lastPreflight = undefined;
    }
    if (this.lastPreflight && !this.preflightPromise) {
      return this.lastPreflight;
    }
    this.schedulePreflight();
    return this.preflightPromise ?? runPreflight();
  }

  /** Writes pending history to disk. Call before quitting. */
  async flush(): Promise<void> {
    this.flushLogs();
    await this.historyStore.flush();
  }

  private schedulePreflight(): void {
    if (this.preflightReady || this.preflightPromise) {
      return;
    }

    this.preflightPromise = runPreflight()
      .then((report) => {
        this.lastPreflight = report;
        this.preflightPromise = undefined;
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
      return;
    }

    const missing = preflight.binaries.filter((item) => !item.available);
    const names = missing.map((item) => item.name).join(" and ");
    throw new Error(`${names} could not be started. ${missing[0]?.installHint ?? ""}`.trim());
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

  /**
   * Records tool output. Progress lines become throttled progress events; other
   * lines are batched so the window gets one message per flush, not one per line.
   */
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

      const progress = parseProgressLine(trimmed);
      if (progress) {
        this.reportProgress(jobId, progress);
        continue;
      }

      const stamped = `[${new Date().toLocaleTimeString()}] ${trimmed}`;
      job.logs.push(stamped);
      if (job.logs.length > 250) {
        job.logs.splice(0, job.logs.length - 250);
      }
      const pending = this.pendingLogLines.get(jobId) ?? [];
      pending.push(stamped);
      this.pendingLogLines.set(jobId, pending);
    }

    if (!this.logFlushTimer && this.pendingLogLines.size > 0) {
      this.logFlushTimer = setTimeout(() => this.flushLogs(), LOG_FLUSH_MS);
    }
  }

  private flushLogs(): void {
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer);
      this.logFlushTimer = undefined;
    }
    for (const [jobId, lines] of this.pendingLogLines) {
      const event: JobEvent = { type: "job-log", jobId, lines };
      this.emit("event", event);
    }
    this.pendingLogLines.clear();
  }

  private reportProgress(jobId: string, progress: JobProgress): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    job.progress = progress;

    const now = Date.now();
    const last = this.lastProgressEmit.get(jobId) ?? 0;
    if (now - last < PROGRESS_EMIT_MS && progress.fraction !== 1) {
      return;
    }
    this.lastProgressEmit.set(jobId, now);
    const event: JobEvent = { type: "job-progress", jobId, progress };
    this.emit("event", event);
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
    if (FINISHED_STATUSES.has(merged.status) || merged.status === "awaiting_user_choice") {
      merged.progress = undefined;
      this.lastProgressEmit.delete(jobId);
    }

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

      const message = errorMessage(error);
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
      "awaiting_trim",
      "trimming",
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

    const pendingTrim = this.pendingTrims.get(jobId);
    if (pendingTrim) {
      this.pendingTrims.delete(jobId);
      await rm(pendingTrim.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }

    return this.updateJob(jobId, { status: "cancelled" });
  }

  async deleteJob(jobId: string): Promise<boolean> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return false;
    }

    if (this.controllers.has(jobId) || this.pendingChoices.has(jobId) || this.pendingTrims.has(jobId)) {
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

  /** Removes finished, failed and cancelled jobs, leaving anything still running or waiting. */
  async clearFinished(): Promise<void> {
    for (const job of Array.from(this.jobs.values())) {
      if (FINISHED_STATUSES.has(job.status)) {
        this.jobs.delete(job.jobId);
        await this.historyStore.delete(job.jobId);
      }
    }
  }

  async clearHistory(): Promise<void> {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();

    for (const pending of [...this.pendingChoices.values(), ...this.pendingTrims.values()]) {
      await rm(pending.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
    this.pendingChoices.clear();
    this.pendingTrims.clear();

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
    if (existing.request.qualityMode === "video_mp4") {
      throw new Error("Metadata re-apply is not available for MP4 video jobs.");
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

      tempDir = await mkdtemp(path.join(os.tmpdir(), "audio-ripper-"));
      const { videoInfo, infoJsonPath } = await analyzeVideo(existing.request.url, existing.request.qualityMode, tempDir);
      await this.updateJob(jobId, {
        status: "downloading",
        videoInfo
      });

      const video = existing.request.qualityMode === "video_mp4";
      const downloadedPath = video
        ? await downloadVideoAsMp4({
            url: existing.request.url,
            infoJsonPath,
            tempDir,
            expectedVideoId: videoInfo.id,
            downloadSpeedProfile: existing.request.downloadSpeedProfile || "balanced",
            signal: controller.signal,
            onLog: (line) => this.appendLog(jobId, line)
          })
        : await downloadAudio({
            url: existing.request.url,
            infoJsonPath,
            formatId: videoInfo.selectedFormat.formatId,
            downloadSpeedProfile: existing.request.downloadSpeedProfile || "balanced",
            tempDir,
            expectedVideoId: videoInfo.id,
            signal: controller.signal,
            onLog: (line) => this.appendLog(jobId, line)
          });

      if (existing.request.trim) {
        // Register the pending trim before announcing it, so the editor can load the file at once.
        this.pendingTrims.set(jobId, { tempDir, downloadedPath, infoJsonPath });
        this.controllers.delete(jobId);
        await this.updateJob(jobId, { status: "awaiting_trim" });
        tempDir = undefined;
        return;
      }

      await this.continueAfterDownload(jobId, tempDir, downloadedPath);
      tempDir = undefined;
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  /** Everything after the file is downloaded (and trimmed, if asked): tags for audio, then the library. */
  private async continueAfterDownload(jobId: string, tempDir: string, downloadedPath: string): Promise<void> {
    const existing = this.jobs.get(jobId);
    if (!existing?.videoInfo) {
      throw new Error("Job disappeared from queue.");
    }
    const videoInfo = existing.videoInfo;

    if (existing.request.qualityMode === "video_mp4") {
      const finalOutputPath = await moveVideoIntoLibrary({
        stagedFilePath: downloadedPath,
        outputRoot: existing.request.outputRoot,
        title: videoInfo.title
      });
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);

      this.controllers.delete(jobId);
      await this.updateJob(jobId, {
        status: "completed",
        outputPath: finalOutputPath,
        warnings: existing.warnings
      });
      return;
    }

    const probeInfo = probeInfoFromFormat(videoInfo);
    if (existing.trimRange) {
      probeInfo.duration = existing.trimRange.end - existing.trimRange.start;
    }

    await this.updateJob(jobId, {
      status: "resolving_metadata",
      probeInfo
    });

    const metadataResolution = await resolveCandidatesFromVideo(videoInfo);
    // Compare the top candidate with the user's own threshold, not the resolver's default.
    const bestCandidate = metadataResolution.candidates[0];

    await this.updateJob(jobId, {
      metadataCandidates: metadataResolution.candidates
    });

    if (!bestCandidate || bestCandidate.score < this.settings.metadataAutoSelectThreshold) {
      // Register the pending choice before announcing it, so an immediate answer finds it.
      this.pendingChoices.set(jobId, {
        tempDir,
        downloadedAudioPath: downloadedPath
      });
      await this.updateJob(jobId, {
        status: "awaiting_user_choice"
      });
      this.controllers.delete(jobId);
      return;
    }

    await this.updateJob(jobId, {
      status: "tagging",
      selectedMetadata: bestCandidate.metadata
    });

    await this.finalizeJob(jobId, tempDir, downloadedPath, bestCandidate);
  }

  /** The waveform and playable address of a download waiting to be trimmed. */
  async getTrimSource(jobId: string): Promise<TrimSource> {
    const pending = this.pendingTrims.get(jobId);
    if (!pending) {
      throw new Error("This download is not waiting to be trimmed.");
    }
    const audioOnly = this.jobs.get(jobId)?.request.qualityMode !== "video_mp4";
    pending.waveform ??= Promise.all([
      readWaveform(pending.downloadedPath),
      audioOnly ? readPreviewUrl(pending.infoJsonPath) : undefined
    ]).then(([{ duration, peaks }, previewUrl]) => ({
      mediaUrl: `liner-media://${jobId}/`,
      duration: duration || this.jobs.get(jobId)?.videoInfo?.duration || 0,
      peaks,
      previewUrl
    }));
    pending.waveform.catch(() => {
      // Let the next request try again.
      if (this.pendingTrims.get(jobId) === pending) {
        pending.waveform = undefined;
      }
    });
    return pending.waveform;
  }

  /** The file on disk behind a pending trim, for the media protocol. */
  getTrimFilePath(jobId: string): string | undefined {
    return this.pendingTrims.get(jobId)?.downloadedPath;
  }

  /** Cuts a download waiting to be trimmed (or keeps it whole) and finishes the job. */
  async applyTrim(input: ApplyTrimInput): Promise<ExtractionJobRecord> {
    const pending = this.pendingTrims.get(input.jobId);
    const job = this.jobs.get(input.jobId);
    if (!pending || !job) {
      throw new Error("This download is not waiting to be trimmed.");
    }
    const range = input.range ? normalizeTrimRange(input.range, job.videoInfo?.duration) : undefined;
    this.pendingTrims.delete(input.jobId);

    const controller = new AbortController();
    this.controllers.set(input.jobId, controller);
    const updated = await this.updateJob(input.jobId, {
      status: range ? "trimming" : job.status,
      trimRange: range
    });

    void (async () => {
      let tempDir: string | undefined = pending.tempDir;
      try {
        let mediaPath = pending.downloadedPath;
        if (range) {
          this.appendLog(input.jobId, `Trimming to ${range.start.toFixed(1)} s – ${range.end.toFixed(1)} s`);
          mediaPath = await trimMedia({
            inputPath: pending.downloadedPath,
            outputDir: pending.tempDir,
            range,
            video: job.request.qualityMode === "video_mp4",
            signal: controller.signal,
            onLog: (line) => this.appendLog(input.jobId, line)
          });
          await rm(pending.downloadedPath, { force: true }).catch(() => undefined);
        }
        await this.continueAfterDownload(input.jobId, pending.tempDir, mediaPath);
        tempDir = undefined;
      } catch (error: unknown) {
        if (!this.jobs.has(input.jobId) || this.jobs.get(input.jobId)?.status === "cancelled") {
          return;
        }
        const message = errorMessage(error);
        this.appendLog(input.jobId, `ERROR: ${message}`);
        this.controllers.delete(input.jobId);
        await this.updateJob(input.jobId, { status: "failed", error: message }).catch(() => undefined);
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    })();

    return updated;
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
