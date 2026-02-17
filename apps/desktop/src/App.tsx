import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type {
  ExtractionJobRecord,
  JobEvent,
  JobStatus,
  MetadataCandidate,
  PreflightReport,
  Settings,
  TrackMetadata
} from "@audio-ripper/shared";

type DesktopBridge = NonNullable<Window["audioRipper"]>;
type ThemeMode = "light" | "dark";
type ArtworkSource = "candidate" | "custom" | "none";

interface ArtworkDraft {
  source: ArtworkSource;
  previewUrl?: string;
  dataUrl?: string;
}

function readThemeMode(): ThemeMode {
  try {
    return window.localStorage.getItem("yar-theme-mode") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function emptyMetadata(): TrackMetadata {
  return {
    title: "",
    artist: "",
    album: "",
    albumArtist: "",
    trackNumber: undefined,
    discNumber: undefined,
    year: undefined,
    genre: ""
  };
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function isJobCancelable(status: JobStatus): boolean {
  return [
    "queued",
    "analyzing",
    "downloading",
    "resolving_metadata",
    "awaiting_user_choice",
    "tagging"
  ].includes(status);
}

function canShowInFinder(job: ExtractionJobRecord): boolean {
  return Boolean(job.outputPath);
}

function upsertJob(list: ExtractionJobRecord[], job: ExtractionJobRecord): ExtractionJobRecord[] {
  const next = [job, ...list.filter((item) => item.jobId !== job.jobId)];
  return next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function artworkFromCandidate(candidate: MetadataCandidate | undefined): ArtworkDraft {
  if (!candidate) {
    return { source: "none" };
  }

  if (candidate.coverArtDataUrl) {
    return {
      source: "custom",
      previewUrl: candidate.coverArtDataUrl,
      dataUrl: candidate.coverArtDataUrl
    };
  }

  if (candidate.coverArtUrl) {
    return {
      source: "candidate",
      previewUrl: candidate.coverArtUrl
    };
  }

  return { source: "none" };
}

export function App(): JSX.Element {
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [jobs, setJobs] = useState<ExtractionJobRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [url, setUrl] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);
  const [metadataDraft, setMetadataDraft] = useState<TrackMetadata>(emptyMetadata());
  const [artworkDraft, setArtworkDraft] = useState<ArtworkDraft>({ source: "none" });
  const [notice, setNotice] = useState<string>("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const artworkFileInputRef = useRef<HTMLInputElement | null>(null);
  const isVideoTargetMode = settings?.qualityMode === "video_mp4";

  function getBridge(): DesktopBridge | null {
    if (window.audioRipper) {
      return window.audioRipper;
    }
    setNotice("Desktop bridge failed to load. Relaunch the app.");
    return null;
  }

  useEffect(() => {
    let unsubscribe: (() => Promise<void>) | undefined;
    let disposed = false;
    let preflightTimer: number | undefined;
    const bridge = getBridge();
    if (!bridge) {
      return undefined;
    }

    const onFailure = (error: unknown): void => {
      if (disposed) {
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to initialize app";
      setNotice(message);
    };

    bridge.subscribeJobEvents((event: JobEvent) => {
      if (event.type === "job-status") {
        setJobs((current) => upsertJob(current, event.job));
        setSelectedJobId((current) => current ?? event.job.jobId);
      }

      if (event.type === "job-log") {
        setJobs((current) =>
          current.map((job) => {
            if (job.jobId !== event.jobId) {
              return job;
            }
            const logs = [...job.logs.slice(-249), `[${new Date(event.timestamp).toLocaleTimeString()}] ${event.line}`];
            return { ...job, logs };
          })
        );
      }
    })
      .then((handler) => {
        if (disposed) {
          void handler();
          return;
        }
        unsubscribe = handler;
      })
      .catch(onFailure);

    void bridge
      .listJobs()
      .then((listedJobs) => {
        if (disposed) {
          return;
        }
        setJobs(listedJobs);
        setSelectedJobId((current) => current ?? listedJobs[0]?.jobId ?? null);
      })
      .catch(onFailure);

    void bridge
      .getSettings()
      .then((loadedSettings) => {
        if (!disposed) {
          setSettings(loadedSettings);
        }
      })
      .catch(onFailure);

    preflightTimer = window.setTimeout(() => {
      void bridge
        .preflight()
        .then((report) => {
          if (!disposed) {
            setPreflight(report);
          }
        })
        .catch(onFailure);
    }, 120);

    return () => {
      disposed = true;
      if (preflightTimer !== undefined) {
        window.clearTimeout(preflightTimer);
      }
      if (unsubscribe) {
        void unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    try {
      window.localStorage.setItem("yar-theme-mode", themeMode);
    } catch {
      // Ignore localStorage failures in restricted contexts.
    }
  }, [themeMode]);

  const selectedJob = useMemo(() => {
    if (selectedJobId) {
      const byId = jobs.find((job) => job.jobId === selectedJobId);
      if (byId) {
        return byId;
      }
    }
    return jobs[0] ?? null;
  }, [jobs, selectedJobId]);

  useEffect(() => {
    setSelectedCandidateIndex(0);
  }, [selectedJob?.jobId]);

  useEffect(() => {
    const candidate = selectedJob?.metadataCandidates?.[selectedCandidateIndex];
    if (candidate) {
      setMetadataDraft({ ...candidate.metadata });
      setArtworkDraft(artworkFromCandidate(candidate));
    } else {
      setMetadataDraft(emptyMetadata());
      setArtworkDraft({ source: "none" });
    }
  }, [selectedJob?.jobId, selectedJob?.metadataCandidates?.length, selectedCandidateIndex]);

  async function refreshPreflight(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      return;
    }
    const report = await bridge.preflight();
    setPreflight(report);
  }

  async function startJob(): Promise<void> {
    if (!settings) {
      return;
    }
    if (!url.trim()) {
      setNotice("Paste a valid YouTube URL.");
      return;
    }

    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    const job = await bridge.createJob({
      url: url.trim(),
      outputRoot: settings.outputRoot,
      qualityMode: settings.qualityMode,
      embedArtwork: settings.embedArtwork,
      downloadSpeedProfile: settings.downloadSpeedProfile
    });

    setJobs((current) => upsertJob(current, job));
    setSelectedJobId(job.jobId);
    setNotice("Job queued.");
  }

  async function saveSettings(): Promise<void> {
    if (!settings) {
      return;
    }
    const bridge = getBridge();
    if (!bridge) {
      return;
    }
    const next = await bridge.updateSettings(settings);
    setSettings(next);
    setNotice("Settings saved.");
  }

  async function cancelSelectedJob(): Promise<void> {
    if (!selectedJob) {
      return;
    }
    if (!isJobCancelable(selectedJob.status)) {
      setNotice("Selected job can no longer be cancelled.");
      return;
    }

    const bridge = getBridge();
    if (!bridge) {
      return;
    }
    await bridge.cancelJob(selectedJob.jobId);
  }

  function applyJobsSnapshot(nextJobs: ExtractionJobRecord[]): void {
    setJobs(nextJobs);
    setSelectedJobId((current) => {
      if (nextJobs.length === 0) {
        return null;
      }
      if (current && nextJobs.some((job) => job.jobId === current)) {
        return current;
      }
      return nextJobs[0]?.jobId ?? null;
    });
  }

  async function deleteJobEntry(jobId: string): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    const job = jobs.find((item) => item.jobId === jobId);
    const label = job?.videoInfo?.title || job?.request.url || jobId;
    const confirmed = window.confirm(`Delete this queue/history item?\n\n${label}`);
    if (!confirmed) {
      return;
    }

    const nextJobs = await bridge.deleteJob(jobId);
    applyJobsSnapshot(nextJobs);
    setNotice("History item deleted.");
  }

  async function clearAllHistory(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    const confirmed = window.confirm("Clear all queue and history items?");
    if (!confirmed) {
      return;
    }

    const nextJobs = await bridge.clearHistory();
    applyJobsSnapshot(nextJobs);
    setNotice("Queue and history cleared.");
  }

  async function showJobInFinder(job: ExtractionJobRecord): Promise<void> {
    if (!job.outputPath) {
      const message =
        job.status === "completed"
          ? "Completed item has no recorded output path."
          : "This item has no output file yet.";
      setNotice(message);
      return;
    }

    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    try {
      const result = await bridge.showInFinder(job.outputPath);
      if (result.ok) {
        setNotice("Opened in Finder.");
        return;
      }

      setNotice(result.message ?? "Opened output location in Finder.");
    } catch {
      setNotice("Unable to open Finder for this item.");
    }
  }

  async function chooseMetadataCandidate(): Promise<void> {
    if (!selectedJob || !selectedJob.metadataCandidates?.length) {
      return;
    }

    const baseCandidate = selectedJob.metadataCandidates[selectedCandidateIndex] as MetadataCandidate | undefined;
    if (!baseCandidate) {
      return;
    }
    const candidate: MetadataCandidate = {
      ...baseCandidate,
      coverArtUrl: artworkDraft.source === "candidate" ? baseCandidate.coverArtUrl : undefined,
      coverArtDataUrl: artworkDraft.source === "custom" ? artworkDraft.dataUrl : undefined,
      metadata: {
        ...metadataDraft,
        title: metadataDraft.title || baseCandidate.metadata.title,
        artist: metadataDraft.artist || baseCandidate.metadata.artist,
        album: metadataDraft.album || baseCandidate.metadata.album
      }
    };

    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    try {
      await bridge.chooseMetadata({
        jobId: selectedJob.jobId,
        candidate
      });

      setNotice(selectedJob.status === "completed" ? "Metadata updated for completed file." : "Metadata applied.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to apply metadata.";
      setNotice(message);
    }
  }

  async function handleArtworkFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setNotice("Please select an image file for artwork.");
      event.target.value = "";
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.readAsDataURL(file);
    }).catch(() => "");

    if (!dataUrl) {
      setNotice("Could not load artwork image.");
      event.target.value = "";
      return;
    }

    setArtworkDraft({
      source: "custom",
      previewUrl: dataUrl,
      dataUrl
    });
    setNotice(`Artwork set from ${file.name}.`);
    event.target.value = "";
  }

  function chooseArtworkFile(): void {
    artworkFileInputRef.current?.click();
  }

  function removeArtwork(): void {
    setArtworkDraft({ source: "none" });
    setNotice("Artwork removed for this selection.");
  }

  function resetArtworkFromCandidate(): void {
    const candidate = selectedJob?.metadataCandidates?.[selectedCandidateIndex];
    setArtworkDraft(artworkFromCandidate(candidate));
    setNotice("Artwork reset to candidate source.");
  }

  const selectedCandidate = selectedJob?.metadataCandidates?.[selectedCandidateIndex];
  const isVideoJob = selectedJob?.request.qualityMode === "video_mp4";
  const artworkSourceLabel =
    artworkDraft.source === "custom"
      ? "Local upload"
      : selectedCandidate?.source === "musicbrainz"
        ? "Cover Art Archive (via MusicBrainz release)"
        : selectedCandidate?.source === "youtube"
          ? "YouTube thumbnail"
          : "None";

  async function toggleWindowMaximize(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    try {
      await bridge.toggleWindowMaximize();
    } catch {
      setNotice("Unable to resize window.");
    }
  }

  function updateDraft(field: keyof TrackMetadata, value: string): void {
    setMetadataDraft((current) => {
      if (["trackNumber", "discNumber", "year"].includes(field)) {
        const numeric = value ? Number(value) : undefined;
        return { ...current, [field]: Number.isFinite(numeric) ? numeric : undefined };
      }
      return { ...current, [field]: value };
    });
  }

  const canApplyMetadata =
    !isVideoJob &&
    (selectedJob?.status === "awaiting_user_choice" ||
      (selectedJob?.status === "completed" && Boolean(selectedJob.outputPath)));

  return (
    <>
      <div className="titlebar" onDoubleClick={() => void toggleWindowMaximize()}>
        <p className="titlebar-label">YouTube Audio Ripper</p>
      </div>

      <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Editorial Audio Workstation</p>
          <h1>YouTube Audio Ripper</h1>
          <p className="subtitle">Source-fidelity extraction with assisted metadata and cover embedding.</p>
        </div>
        <div className="hero-actions">
          <button className="outline" onClick={refreshPreflight}>Re-check binaries</button>
          {selectedJob && isJobCancelable(selectedJob.status) ? <button className="outline" onClick={cancelSelectedJob}>Cancel selected</button> : null}
        </div>
      </header>

      <section className="grid-top">
        <article className="panel intake">
          <h2>Home / Paste URL</h2>
          <label>
            YouTube URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </label>
          <button className="primary" onClick={startJob}>
            {isVideoTargetMode ? "Analyze + Download MP4" : "Analyze + Download"}
          </button>
          <p className="muted">
            Target mode: {isVideoTargetMode ? "YouTube video (MP4)" : "Audio extraction"}
          </p>
          {notice ? <p className="notice">{notice}</p> : null}

          <div className="badge-row">
            {preflight?.binaries.map((item) => (
              <span key={item.name} className={`badge ${item.available ? "ok" : "error"}`}>
                {item.name}: {item.available ? "ready" : "missing"}
              </span>
            ))}
          </div>
        </article>

        <article className="panel preview">
          <h2>Track Preview</h2>
          {selectedJob?.videoInfo ? (
            <>
              <img src={selectedJob.videoInfo.thumbnail} alt="video thumbnail" />
              <p className="title">{selectedJob.videoInfo.title}</p>
              <p>{selectedJob.videoInfo.channel ?? selectedJob.videoInfo.uploader}</p>
              <p>
                Format: <strong>{selectedJob.videoInfo.selectedFormat.formatId}</strong> / {selectedJob.videoInfo.selectedFormat.ext ?? "unknown"}
              </p>
              <p>
                {isVideoJob ? "Video score" : "Audio score"}: <strong>{selectedJob.videoInfo.selectedFormat.audioQualityScore.toFixed(1)}</strong>
              </p>
              <p>
                Status: <span className={`status ${selectedJob.status}`}>{statusLabel(selectedJob.status)}</span>
              </p>
            </>
          ) : (
            <p className="muted">Pick or create a job to preview media details.</p>
          )}
        </article>
      </section>

      <section className="grid-middle">
        <article className="panel metadata">
          <h2>Metadata Review</h2>
          {isVideoJob ? (
            <p className="muted">MP4 video mode skips audio metadata tagging and artwork embedding.</p>
          ) : !selectedJob?.metadataCandidates?.length ? (
            <p className="muted">Metadata candidates will appear after extraction starts.</p>
          ) : (
            <div className="metadata-layout">
              <div className="candidate-list">
                {selectedJob.metadataCandidates.map((candidate, index) => (
                  <button
                    key={`${candidate.source}-${candidate.metadata.title}-${index}`}
                    className={index === selectedCandidateIndex ? "candidate active" : "candidate"}
                    onClick={() => setSelectedCandidateIndex(index)}
                  >
                    <strong>{candidate.metadata.artist} - {candidate.metadata.title}</strong>
                    <span>{candidate.metadata.album}</span>
                    <span>Source: {candidate.source}</span>
                    <span>Confidence: {(candidate.score * 100).toFixed(0)}%</span>
                  </button>
                ))}
              </div>

              <div className="edit-form">
                <div className="artwork-panel">
                  <p className="artwork-title">Artwork</p>
                  <div className="artwork-preview">
                    {artworkDraft.previewUrl ? (
                      <img src={artworkDraft.previewUrl} alt="selected artwork" />
                    ) : (
                      <p className="muted">No artwork selected.</p>
                    )}
                  </div>
                  <p className="artwork-source">Source: {artworkSourceLabel}</p>
                  <div className="artwork-actions">
                    <input
                      ref={artworkFileInputRef}
                      className="hidden-file-input"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        void handleArtworkFileChange(event);
                      }}
                    />
                    <button className="outline" type="button" onClick={chooseArtworkFile}>Replace artwork</button>
                    <button className="outline" type="button" onClick={removeArtwork}>Remove artwork</button>
                    <button className="outline" type="button" onClick={resetArtworkFromCandidate}>Reset source</button>
                  </div>
                </div>

                <label>Title<input value={metadataDraft.title ?? ""} onChange={(event) => updateDraft("title", event.target.value)} /></label>
                <label>Artist<input value={metadataDraft.artist ?? ""} onChange={(event) => updateDraft("artist", event.target.value)} /></label>
                <label>Album<input value={metadataDraft.album ?? ""} onChange={(event) => updateDraft("album", event.target.value)} /></label>
                <label>Album Artist<input value={metadataDraft.albumArtist ?? ""} onChange={(event) => updateDraft("albumArtist", event.target.value)} /></label>
                <label>Track #<input value={metadataDraft.trackNumber ?? ""} onChange={(event) => updateDraft("trackNumber", event.target.value)} /></label>
                <label>Disc #<input value={metadataDraft.discNumber ?? ""} onChange={(event) => updateDraft("discNumber", event.target.value)} /></label>
                <label>Year<input value={metadataDraft.year ?? ""} onChange={(event) => updateDraft("year", event.target.value)} /></label>
                <label>Genre<input value={metadataDraft.genre ?? ""} onChange={(event) => updateDraft("genre", event.target.value)} /></label>

                <button
                  className="primary"
                  onClick={chooseMetadataCandidate}
                  disabled={!canApplyMetadata}
                >
                  {selectedJob.status === "completed" ? "Re-apply Metadata" : "Apply Selection and Finish"}
                </button>
              </div>
            </div>
          )}
        </article>

        <article className="panel queue">
          <div className="queue-header">
            <h2>Queue & History</h2>
            {jobs.length > 0 ? <button className="outline queue-clear" onClick={clearAllHistory}>Clear all</button> : null}
          </div>
          <div className="queue-list">
            {jobs.map((job) => (
              <div
                key={job.jobId}
                className={job.jobId === selectedJob?.jobId ? "queue-item active" : "queue-item"}
              >
                <button className="queue-select" onClick={() => setSelectedJobId(job.jobId)}>
                  <div className="queue-head">
                    <span className="mono">{job.jobId.slice(0, 8)}</span>
                    <span className={`status ${job.status}`}>{statusLabel(job.status)}</span>
                  </div>
                  <p>{job.videoInfo?.title || job.request.url}</p>
                  {job.outputPath ? <p className="mono">{job.outputPath}</p> : null}
                </button>
                <div className="queue-actions">
                  <button
                    className="outline queue-finder"
                    onClick={() => void showJobInFinder(job)}
                    disabled={!canShowInFinder(job)}
                    title={canShowInFinder(job) ? "Reveal output in Finder" : "No output file yet"}
                  >
                    Show in Finder
                  </button>
                  <button className="outline queue-delete" onClick={() => void deleteJobEntry(job.jobId)}>Delete</button>
                </div>
              </div>
            ))}
            {jobs.length === 0 ? <p className="muted">No jobs yet.</p> : null}
          </div>
        </article>
      </section>

      <section className="grid-bottom">
        <article className="panel settings">
          <h2>Settings</h2>
          {settings ? (
            <div className="settings-form">
              <label>
                Output root
                <input
                  value={settings.outputRoot}
                  onChange={(event) => setSettings({ ...settings, outputRoot: event.target.value })}
                />
              </label>
              <label>
                Quality mode
                <select
                  value={settings.qualityMode}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      qualityMode: event.target.value as Settings["qualityMode"]
                    })
                  }
                >
                  <option value="source_fidelity">source_fidelity</option>
                  <option value="mp3_320_export">mp3_320_export</option>
                  <option value="video_mp4">video_mp4</option>
                </select>
              </label>
              <label>
                Download speed
                <select
                  value={settings.downloadSpeedProfile}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      downloadSpeedProfile: event.target.value as Settings["downloadSpeedProfile"]
                    })
                  }
                >
                  <option value="safe">safe</option>
                  <option value="balanced">balanced</option>
                  <option value="aggressive">aggressive</option>
                </select>
              </label>
              <label className="appearance-control">
                Appearance
                <select
                  value={themeMode}
                  onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
                >
                  <option value="dark">dark</option>
                  <option value="light">light</option>
                </select>
              </label>
              <label>
                Auto-select threshold
                <input
                  value={settings.metadataAutoSelectThreshold}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      metadataAutoSelectThreshold: Number(event.target.value) || 0.86
                    })
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={settings.embedArtwork}
                  disabled={settings.qualityMode === "video_mp4"}
                  onChange={(event) => setSettings({ ...settings, embedArtwork: event.target.checked })}
                />
                {settings.qualityMode === "video_mp4" ? "Artwork embedding is audio-only" : "Embed artwork when possible"}
              </label>
              <button className="primary" onClick={saveSettings}>Save settings</button>
            </div>
          ) : (
            <p className="muted">Loading settings...</p>
          )}
        </article>

        <article className="panel logs">
          <h2>Logs Drawer</h2>
          <div className="log-list">
            {(selectedJob?.logs ?? []).map((line, index) => (
              <p key={`${line}-${index}`} className="mono">{line}</p>
            ))}
            {(selectedJob?.logs ?? []).length === 0 ? <p className="muted">No logs yet.</p> : null}
          </div>
        </article>
      </section>
      </main>
    </>
  );
}
