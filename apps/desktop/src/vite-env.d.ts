/// <reference types="vite/client" />

import type {
  ChooseMetadataInput,
  CreateJobInput,
  ExtractionJobRecord,
  JobEvent,
  PreflightReport,
  ResolveCandidatesInput,
  ResolveCandidatesOutput,
  Settings
} from "@audio-ripper/shared";

declare global {
  interface Window {
    audioRipper?: {
      preflight: () => Promise<PreflightReport>;
      showInFinder: (targetPath: string) => Promise<{ ok: boolean; message?: string }>;
      createJob: (payload: CreateJobInput) => Promise<ExtractionJobRecord>;
      listJobs: () => Promise<ExtractionJobRecord[]>;
      cancelJob: (jobId: string) => Promise<ExtractionJobRecord | undefined>;
      deleteJob: (jobId: string) => Promise<ExtractionJobRecord[]>;
      clearHistory: () => Promise<ExtractionJobRecord[]>;
      resolveCandidates: (payload: ResolveCandidatesInput) => Promise<ResolveCandidatesOutput>;
      chooseMetadata: (payload: ChooseMetadataInput) => Promise<ExtractionJobRecord>;
      getSettings: () => Promise<Settings>;
      updateSettings: (payload: Settings) => Promise<Settings>;
      toggleWindowMaximize: () => Promise<boolean>;
      subscribeJobEvents: (callback: (event: JobEvent) => void) => Promise<() => Promise<void>>;
    };
  }
}

export {};
