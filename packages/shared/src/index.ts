export type QualityMode = "source_fidelity" | "mp3_320_export";
export type DownloadSpeedProfile = "safe" | "balanced" | "aggressive";

export type MetadataSource = "youtube" | "musicbrainz";

export type JobStatus =
  | "queued"
  | "analyzing"
  | "downloading"
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
  name: "ffmpeg" | "ffprobe" | "yt-dlp";
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

export interface CreateJobInput extends ExtractionRequest {}

export interface JobStatusEvent {
  type: "job-status";
  job: ExtractionJobRecord;
}

export interface JobLogEvent {
  type: "job-log";
  jobId: string;
  line: string;
  timestamp: string;
}

export type JobEvent = JobStatusEvent | JobLogEvent;
