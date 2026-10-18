import type { ExtractionJobRecord, JobStatus, MetadataCandidate, QualityMode } from "@audio-ripper/shared";

export type Tone = "neutral" | "active" | "attention" | "good" | "bad";

export type ViewId = "all" | "active" | "review" | "finished" | "failed";

export const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "all", label: "Downloads" },
  { id: "active", label: "In progress" },
  { id: "review", label: "Needs review" },
  { id: "finished", label: "Finished" },
  { id: "failed", label: "Failed" }
];

const ACTIVE: JobStatus[] = ["queued", "analyzing", "downloading", "resolving_metadata", "tagging"];

export function isActive(job: ExtractionJobRecord): boolean {
  return ACTIVE.includes(job.status);
}

export function isCancelable(job: ExtractionJobRecord): boolean {
  return isActive(job) || job.status === "awaiting_user_choice";
}

export function isVideo(job: ExtractionJobRecord): boolean {
  return job.request.qualityMode === "video_mp4";
}

export function inView(job: ExtractionJobRecord, view: ViewId): boolean {
  switch (view) {
    case "all":
      return true;
    case "active":
      return isActive(job);
    case "review":
      return job.status === "awaiting_user_choice";
    case "finished":
      return job.status === "completed";
    case "failed":
      return job.status === "failed" || job.status === "cancelled";
  }
}

export interface StatusInfo {
  label: string;
  tone: Tone;
  /** Index into stageNames, or -1 when the job is not running. */
  stage: number;
}

export function stageNames(job: ExtractionJobRecord): string[] {
  return isVideo(job) ? ["Fetch", "Download", "Save"] : ["Fetch", "Download", "Match", "Tag"];
}

export function statusInfo(job: ExtractionJobRecord): StatusInfo {
  const video = isVideo(job);
  switch (job.status) {
    case "queued":
      return { label: "Waiting", tone: "neutral", stage: 0 };
    case "analyzing":
      return { label: "Fetching details", tone: "active", stage: 0 };
    case "downloading":
      return { label: "Downloading", tone: "active", stage: 1 };
    case "resolving_metadata":
      return { label: "Finding tags", tone: "active", stage: 2 };
    case "tagging":
      return { label: "Saving", tone: "active", stage: video ? 2 : 3 };
    case "awaiting_user_choice":
      return { label: "Needs review", tone: "attention", stage: -1 };
    case "completed":
      return { label: "Saved", tone: "good", stage: -1 };
    case "failed":
      return { label: "Failed", tone: "bad", stage: -1 };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral", stage: -1 };
  }
}

export function displayTitle(job: ExtractionJobRecord): string {
  return job.selectedMetadata?.title || job.videoInfo?.title || job.request.url;
}

export function displaySubtitle(job: ExtractionJobRecord): string {
  if (!job.videoInfo && !job.selectedMetadata) {
    return job.status === "failed" ? "Couldn't fetch details" : "Getting details…";
  }
  if (isVideo(job)) {
    return job.videoInfo?.channel || job.videoInfo?.uploader || "Video";
  }
  const meta = job.selectedMetadata;
  if (meta) {
    return [meta.artist, meta.album && meta.album !== "Unknown Album" ? meta.album : undefined].filter(Boolean).join(", ");
  }
  return job.videoInfo?.channel || job.videoInfo?.uploader || "";
}

export const FORMAT_LABELS: Record<QualityMode, string> = {
  source_fidelity: "Original",
  mp3_320_export: "MP3 320",
  video_mp4: "Video"
};

export const FORMAT_DESCRIPTIONS: Record<QualityMode, string> = {
  source_fidelity: "Best audio YouTube has, kept as is (usually Opus or AAC)",
  mp3_320_export: "Converted to MP3 at 320 kbps, plays everywhere",
  video_mp4: "Video and audio as an MP4 file"
};

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) {
    return "";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) {
    return "";
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return "";
  }
  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))} s left`;
  }
  return `${Math.round(seconds / 60)} min left`;
}

/** One line describing a running or finished job, e.g. "6.1 of 9.5 MB, 8 s left". */
export function progressLine(job: ExtractionJobRecord): string {
  const progress = job.progress;
  if (job.status === "downloading" && progress) {
    const parts: string[] = [];
    if (progress.downloadedBytes !== undefined && progress.totalBytes) {
      parts.push(`${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)}`);
    }
    const eta = formatEta(progress.etaSeconds);
    if (eta) {
      parts.push(eta);
    }
    return parts.join(", ") || "Downloading";
  }
  return "";
}

const CODEC_LABELS: Record<string, string> = { opus: "Opus", mp4a: "AAC", aac: "AAC", vorbis: "Vorbis", mp3: "MP3", flac: "FLAC" };

export function audioSummary(job: ExtractionJobRecord): string {
  const format = job.videoInfo?.selectedFormat;
  const duration = formatDuration(job.videoInfo?.duration ?? job.probeInfo?.duration);
  if (isVideo(job)) {
    return ["MP4", duration].filter(Boolean).join(", ");
  }
  if (job.request.qualityMode === "mp3_320_export") {
    return ["MP3 320 kbps", duration].filter(Boolean).join(", ");
  }
  const codec = (job.probeInfo?.codec || format?.acodec || "").split(".")[0].toLowerCase();
  const codecLabel = CODEC_LABELS[codec] ?? codec.toUpperCase();
  const kbps = format?.abr ? `${Math.round(format.abr)} kbps` : "";
  return [[codecLabel, kbps].filter(Boolean).join(" "), duration].filter(Boolean).join(", ");
}

export function sourceLabel(candidate: MetadataCandidate): string {
  return candidate.source === "musicbrainz" ? "MusicBrainz" : "From YouTube";
}

export function fileName(filePath: string | undefined): string {
  if (!filePath) {
    return "";
  }
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
