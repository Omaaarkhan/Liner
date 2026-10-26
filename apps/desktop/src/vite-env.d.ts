/// <reference types="vite/client" />

import type {
  ApplyTrimInput,
  ChooseMetadataInput,
  CreateJobInput,
  ExtractionJobRecord,
  JobEvent,
  PreflightReport,
  ResolveCandidatesInput,
  ResolveCandidatesOutput,
  Settings,
  ToolUpdateStatus,
  TrimSource
} from "@audio-ripper/shared";

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/** The API the preload script exposes to the window. See electron/preload.cts. */
export interface RipperBridge {
  platform: string;
  appInfo: () => Promise<{ version: string; platform: string }>;
  readClipboard: () => Promise<string>;
  preflight: (force?: boolean) => Promise<PreflightReport>;
  updateYtDlp: () => Promise<ToolUpdateStatus>;
  showItem: (targetPath: string) => Promise<ActionResult>;
  openFolder: (folder: string) => Promise<ActionResult>;
  chooseFolder: (current?: string) => Promise<string | undefined>;
  createJob: (payload: CreateJobInput) => Promise<ExtractionJobRecord>;
  listJobs: () => Promise<ExtractionJobRecord[]>;
  cancelJob: (jobId: string) => Promise<ExtractionJobRecord | undefined>;
  deleteJob: (jobId: string) => Promise<ExtractionJobRecord[]>;
  trimSource: (jobId: string) => Promise<TrimSource>;
  applyTrim: (payload: ApplyTrimInput) => Promise<ExtractionJobRecord>;
  clearFinished: () => Promise<ExtractionJobRecord[]>;
  clearHistory: () => Promise<ExtractionJobRecord[]>;
  resolveCandidates: (payload: ResolveCandidatesInput) => Promise<ResolveCandidatesOutput>;
  chooseMetadata: (payload: ChooseMetadataInput) => Promise<ExtractionJobRecord>;
  getSettings: () => Promise<Settings>;
  updateSettings: (payload: Settings) => Promise<Settings>;
  toggleWindowMaximize: () => Promise<boolean>;
  onOpenSettings: (callback: () => void) => () => void;
  onPasteAndRip: (callback: () => void) => () => void;
  subscribeJobEvents: (callback: (event: JobEvent) => void) => Promise<() => Promise<void>>;
}

declare global {
  interface Window {
    audioRipper?: RipperBridge;
  }
}
