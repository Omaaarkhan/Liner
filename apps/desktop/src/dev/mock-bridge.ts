/**
 * A fake desktop bridge so the UI can run in a plain browser with `npm run dev:ui`.
 * No Electron, yt-dlp or network needed. All artists and songs are made up.
 */
import type { ExtractionJobRecord, JobEvent, MetadataCandidate, PreflightReport, Settings } from "@audio-ripper/shared";
import type { RipperBridge } from "../vite-env";

function art(a: string, b: string, label = ""): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><circle cx="110" cy="50" r="22" fill="#ffffff55"/><text x="12" y="146" font-family="sans-serif" font-size="14" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const now = Date.now();
const iso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60_000).toISOString();

function baseJob(id: string, partial: Partial<ExtractionJobRecord>): ExtractionJobRecord {
  return {
    jobId: id,
    status: "completed",
    warnings: [],
    logs: ["[10:02:11] Fetching details", "[10:02:12] Picked format 251 (opus, 160 kbps)", "[10:02:19] Download finished"],
    createdAt: iso(30),
    updatedAt: iso(30),
    request: { url: `https://www.youtube.com/watch?v=${id}`, outputRoot: "/Users/you/Music/Liner", qualityMode: "source_fidelity", embedArtwork: true },
    ...partial
  };
}

const reviewCandidates: MetadataCandidate[] = [
  {
    source: "musicbrainz",
    score: 0.82,
    coverArtUrl: art("#2a5d8f", "#183a5a", "Saltwater"),
    metadata: { title: "Low Tide Radio", artist: "Juniper Static", album: "Saltwater", albumArtist: "Juniper Static", trackNumber: 3, year: 2024, genre: "Dream pop", mbid: "a" }
  },
  {
    source: "musicbrainz",
    score: 0.74,
    coverArtUrl: art("#7b2cbf", "#240046", "Single"),
    metadata: { title: "Low Tide Radio", artist: "Juniper Static", album: "Low Tide Radio", year: 2023, mbid: "b" }
  },
  {
    source: "youtube",
    score: 0.55,
    coverArtUrl: art("#333", "#666"),
    metadata: { title: "Low Tide Radio", artist: "Juniper Static", album: "Unknown Album", albumArtist: "Juniper Static" }
  }
];

const TRIM_SECONDS = 96;

/** A made-up song shape: quiet intro, louder chorus swells, fade out. */
function loudnessAt(t: number): number {
  const intro = Math.min(1, t / 8);
  const outro = Math.min(1, (TRIM_SECONDS - t) / 10);
  const swell = 0.55 + 0.35 * Math.sin(t / 7) ** 2;
  const beat = 0.75 + 0.25 * Math.abs(Math.sin(t * Math.PI * 2));
  return Math.max(0, intro * outro * swell * beat);
}

/** A tone whose volume follows loudnessAt, so the mock waveform matches what plays. */
function mockAudioUrl(): string {
  const rate = 8000;
  const samples = rate * TRIM_SECONDS;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    const note = 220 * 2 ** (Math.floor(t / 2) % 5 / 12);
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * note * t) * loudnessAt(t) * 9000, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

let jobs: ExtractionJobRecord[] = [
  baseJob("trim1", {
    status: "awaiting_trim",
    createdAt: iso(0.5),
    request: { url: "https://www.youtube.com/watch?v=trim1", outputRoot: "/Users/you/Music/Liner", qualityMode: "mp3_320_export", embedArtwork: true, trim: true },
    videoInfo: {
      id: "trim1",
      title: "Harbour Choir - Lantern Song (Live at the Old Pier)",
      channel: "Harbour Choir",
      webpageUrl: "https://www.youtube.com/watch?v=trim1",
      thumbnail: art("#14532d", "#a3e635"),
      duration: TRIM_SECONDS,
      selectedFormat: { formatId: "251", ext: "webm", acodec: "opus", abr: 160, audioQualityScore: 160 }
    }
  }),
  baseJob("rev1", {
    status: "awaiting_user_choice",
    createdAt: iso(2),
    videoInfo: {
      id: "rev1",
      title: "Juniper Static - Low Tide Radio (Official Visualizer)",
      channel: "Juniper Static",
      webpageUrl: "https://www.youtube.com/watch?v=rev1",
      thumbnail: art("#3f6d9e", "#10273d"),
      duration: 252,
      selectedFormat: { formatId: "251", ext: "webm", acodec: "opus", abr: 160, audioQualityScore: 160 }
    },
    metadataCandidates: reviewCandidates
  }),
  baseJob("dl1", {
    status: "downloading",
    createdAt: iso(1),
    progress: { fraction: 0.64, downloadedBytes: 6.1 * 1048576, totalBytes: 9.5 * 1048576, etaSeconds: 8 },
    videoInfo: {
      id: "dl1",
      title: "Odessa Vale - Paper Lanterns",
      channel: "Odessa Vale",
      webpageUrl: "https://www.youtube.com/watch?v=dl1",
      thumbnail: art("#f05a3c", "#f7c59f"),
      duration: 277,
      selectedFormat: { formatId: "251", ext: "webm", acodec: "opus", abr: 160, audioQualityScore: 160 }
    }
  }),
  baseJob("done1", {
    createdAt: iso(40),
    outputPath: "/Users/you/Music/Liner/Marlowe & the Tides/Harbour Lights/04 - Night Swim.webm",
    selectedMetadata: { title: "Night Swim", artist: "Marlowe & the Tides", album: "Harbour Lights", trackNumber: 4, year: 2022, genre: "Indie" },
    metadataCandidates: [{ ...reviewCandidates[0], metadata: { title: "Night Swim", artist: "Marlowe & the Tides", album: "Harbour Lights", trackNumber: 4, year: 2022 } }],
    videoInfo: {
      id: "done1",
      title: "Marlowe & the Tides - Night Swim",
      channel: "Marlowe & the Tides",
      webpageUrl: "https://www.youtube.com/watch?v=done1",
      thumbnail: art("#0b132b", "#5bc0be"),
      duration: 252,
      selectedFormat: { formatId: "251", ext: "webm", acodec: "opus", abr: 160, audioQualityScore: 160 }
    }
  }),
  baseJob("vid1", {
    createdAt: iso(90),
    request: { url: "https://www.youtube.com/watch?v=vid1", outputRoot: "/Users/you/Music/Liner", qualityMode: "video_mp4", embedArtwork: false },
    outputPath: "/Users/you/Music/Liner/Videos/Studio Session No. 4.mp4",
    videoInfo: {
      id: "vid1",
      title: "Studio Session No. 4",
      channel: "The Allotments",
      webpageUrl: "https://www.youtube.com/watch?v=vid1",
      thumbnail: art("#222", "#f2e8cf"),
      duration: 1120,
      selectedFormat: { formatId: "137", ext: "mp4", vcodec: "avc1", audioQualityScore: 4000 }
    }
  }),
  baseJob("fail1", {
    status: "failed",
    createdAt: iso(120),
    error: "This video is private. Sign in or ask the owner for access.",
    videoInfo: undefined
  })
];

let settings: Settings = {
  outputRoot: "/Users/you/Music/Liner",
  qualityMode: "source_fidelity",
  embedArtwork: true,
  downloadSpeedProfile: "balanced",
  metadataAutoSelectThreshold: 0.86,
  filenameTemplate: "",
  theme: "system"
};

const preflight: PreflightReport = {
  allReady: true,
  binaries: [
    { name: "ffmpeg", available: true, version: "bundled: ffmpeg version 6.1.1" },
    { name: "yt-dlp", available: true, version: "bundled: 2026.08.19" }
  ]
};

const listeners = new Set<(event: JobEvent) => void>();
const emit = (event: JobEvent) => listeners.forEach((listener) => listener(event));

// Animate the running download.
window.setInterval(() => {
  const job = jobs.find((item) => item.status === "downloading");
  if (!job?.progress) {
    return;
  }
  const fraction = Math.min(1, (job.progress.fraction ?? 0) + 0.03);
  job.progress = { ...job.progress, fraction, downloadedBytes: fraction * 9.5 * 1048576, etaSeconds: Math.max(1, (1 - fraction) * 22) };
  emit({ type: "job-progress", jobId: job.jobId, progress: job.progress });
  if (fraction >= 1) {
    job.progress.fraction = 0.05;
  }
}, 700);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const mockBridge: RipperBridge = {
  platform: new URLSearchParams(location.search).get("platform") ?? "darwin",
  appInfo: async () => ({ version: "0.2.0-dev", platform: "darwin" }),
  readClipboard: async () => "https://www.youtube.com/watch?v=example",
  preflight: async () => clone(preflight),
  updateYtDlp: async () => ({ updated: false, currentVersion: "2026.08.19", latestVersion: "2026.08.19", message: "yt-dlp is up to date." }),
  showItem: async () => ({ ok: true }),
  openFolder: async () => ({ ok: true }),
  chooseFolder: async () => "/Users/you/Music/Liner",
  createJob: async (payload) => {
    const job = baseJob(`new${Date.now()}`, { status: "analyzing", request: payload, createdAt: new Date().toISOString(), logs: [] });
    jobs = [job, ...jobs];
    return clone(job);
  },
  listJobs: async () => clone(jobs),
  cancelJob: async (jobId) => {
    const job = jobs.find((item) => item.jobId === jobId);
    if (job) {
      job.status = "cancelled";
      job.progress = undefined;
      emit({ type: "job-status", job: clone(job) });
    }
    return job;
  },
  deleteJob: async (jobId) => {
    jobs = jobs.filter((item) => item.jobId !== jobId);
    return clone(jobs);
  },
  trimSource: async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    const peaks = Array.from({ length: 800 }, (_, i) => loudnessAt((i / 800) * TRIM_SECONDS) * (0.85 + 0.15 * Math.random()));
    return { mediaUrl: mockAudioUrl(), duration: TRIM_SECONDS, peaks };
  },
  applyTrim: async ({ jobId, range }) => {
    const job = jobs.find((item) => item.jobId === jobId)!;
    job.status = "completed";
    job.trimRange = range;
    job.selectedMetadata = { title: "Lantern Song (Live)", artist: "Harbour Choir", album: "Unknown Album" };
    job.outputPath = "/Users/you/Music/Liner/Harbour Choir/Unknown Album/Lantern Song (Live).mp3";
    emit({ type: "job-status", job: clone(job) });
    return clone(job);
  },
  clearFinished: async () => {
    jobs = jobs.filter((item) => !["completed", "failed", "cancelled"].includes(item.status));
    return clone(jobs);
  },
  clearHistory: async () => {
    jobs = [];
    return [];
  },
  resolveCandidates: async () => ({ candidates: reviewCandidates }),
  chooseMetadata: async ({ jobId, candidate }) => {
    const job = jobs.find((item) => item.jobId === jobId)!;
    job.status = "completed";
    job.selectedMetadata = candidate.metadata;
    job.outputPath = `/Users/you/Music/Liner/${candidate.metadata.artist}/${candidate.metadata.album}/${candidate.metadata.title}.webm`;
    emit({ type: "job-status", job: clone(job) });
    return clone(job);
  },
  getSettings: async () => clone(settings),
  updateSettings: async (next) => {
    settings = next;
    return clone(settings);
  },
  toggleWindowMaximize: async () => false,
  onOpenSettings: () => () => undefined,
  onPasteAndRip: () => () => undefined,
  subscribeJobEvents: async (callback) => {
    listeners.add(callback);
    return async () => {
      listeners.delete(callback);
    };
  }
};
