export type QualityMode = "source_fidelity" | "mp3_320_export" | "video_mp4";
export type DownloadSpeedProfile = "safe" | "balanced" | "aggressive";
export type ThemePreference = "system" | "light" | "dark";

export type MetadataSource = "youtube" | "musicbrainz";

export type JobStatus =
  | "queued"
  | "analyzing"
  | "downloading"
  | "awaiting_trim"
  | "trimming"
  | "resolving_metadata"
  | "awaiting_user_choice"
  | "tagging"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExtractionRequest {
  url: string;
  outputRoot: string;
  qualityMode: QualityMode;
  embedArtwork: boolean;
  downloadSpeedProfile?: DownloadSpeedProfile;
  /** Pause after the download so the user can pick the part to keep. */
  trim?: boolean;
}

/** A span of the source media, in seconds. */
export interface TrimRange {
  start: number;
  end: number;
}

export interface TrackMetadata {
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  isrc?: string;
  mbid?: string;
}

export interface MetadataCandidate {
  source: MetadataSource;
  score: number;
  metadata: TrackMetadata;
  releaseMbid?: string;
  coverArtUrl?: string;
  coverArtDataUrl?: string;
}

export interface ExtractionWarning {
  code: string;
  message: string;
}

export interface BinaryStatus {
  name: "ffmpeg" | "yt-dlp";
  available: boolean;
  version?: string;
  installHint?: string;
}

export interface PreflightReport {
  binaries: BinaryStatus[];
  allReady: boolean;
}

export interface YouTubeFormatInfo {
  formatId: string;
  ext?: string;
  acodec?: string;
  vcodec?: string;
  abr?: number;
  tbr?: number;
  filesize?: number;
  asr?: number;
  audioChannels?: number;
  audioQualityScore: number;
}

export interface YouTubeVideoInfo {
  id: string;
  title: string;
  uploader?: string;
  channel?: string;
  description?: string;
  webpageUrl: string;
  thumbnail?: string;
  duration?: number;
  selectedFormat: YouTubeFormatInfo;
}

export interface ProbeAudioInfo {
  codec?: string;
  container?: string;
  bitrate?: number;
  duration?: number;
  sampleRate?: number;
  channels?: number;
}

export interface JobProgress {
  /** 0..1 when the total size is known. */
  fraction?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  etaSeconds?: number;
  speedBytesPerSecond?: number;
}

export interface ExtractionResult {
  jobId: string;
  status: JobStatus;
  outputPath?: string;
  warnings: ExtractionWarning[];
  videoInfo?: YouTubeVideoInfo;
  probeInfo?: ProbeAudioInfo;
  selectedMetadata?: TrackMetadata;
  metadataCandidates?: MetadataCandidate[];
  error?: string;
  progress?: JobProgress;
  /** The part of the source that was kept, when the job was trimmed. */
  trimRange?: TrimRange;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractionJobRecord extends ExtractionResult {
  request: ExtractionRequest;
  logs: string[];
}

export interface Settings {
  outputRoot: string;
  qualityMode: QualityMode;
  embedArtwork: boolean;
  downloadSpeedProfile: DownloadSpeedProfile;
  metadataAutoSelectThreshold: number;
  filenameTemplate: string;
  theme: ThemePreference;
}

export interface ResolveCandidatesInput {
  title: string;
  artistHint?: string;
  albumHint?: string;
  description?: string;
}

export interface ResolveCandidatesOutput {
  candidates: MetadataCandidate[];
  autoSelected?: MetadataCandidate;
}

export interface ChooseMetadataInput {
  jobId: string;
  candidate: MetadataCandidate;
}

export interface ApplyTrimInput {
  jobId: string;
  /** Leave out to keep the whole download. */
  range?: TrimRange;
}

/** What the trim editor needs to draw and play a downloaded file. */
export interface TrimSource {
  /** Address the window can load in an audio or video element. */
  mediaUrl: string;
  duration: number;
  /** Loudness per slice of the file, 0..1, evenly spaced over the duration. */
  peaks: number[];
}

export interface CreateJobInput extends ExtractionRequest {}

export interface JobStatusEvent {
  type: "job-status";
  job: ExtractionJobRecord;
}

/** Log lines are batched; each line already carries its time prefix. */
export interface JobLogEvent {
  type: "job-log";
  jobId: string;
  lines: string[];
}

export interface JobProgressEvent {
  type: "job-progress";
  jobId: string;
  progress: JobProgress;
}

export type JobEvent = JobStatusEvent | JobLogEvent | JobProgressEvent;

export interface ToolUpdateStatus {
  currentVersion?: string;
  latestVersion?: string;
  updated: boolean;
  message?: string;
}
