import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type JSX } from "react";
import type { ExtractionJobRecord, MetadataCandidate, QualityMode, TrimRange } from "@audio-ripper/shared";
import { Inspector } from "./components/Inspector";
import { JobList } from "./components/JobList";
import { SettingsSheet } from "./components/SettingsSheet";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { inView, looksLikeUrl, needsReview, type ViewId } from "./lib/jobs";
import { useRipper } from "./lib/useRipper";

const bridge = window.audioRipper;
const platform = bridge?.platform ?? "darwin";
const isMac = platform === "darwin";
const PASTE_SHORTCUT = isMac ? "⌘⇧V" : "Ctrl+Shift+V";
const REVEAL_LABEL = isMac ? "Show in Finder" : platform === "win32" ? "Show in Explorer" : "Show in folder";

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function App(): JSX.Element {
  const ripper = useRipper(bridge);
  const { jobs, settings, preflight, toast, showToast, dismissToast, startDownload, changeSettings } = ripper;
  const [view, setView] = useState<ViewId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<QualityMode>("source_fidelity");
  const [trim, setTrim] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.platform = platform;
  }, []);

  // The format picker starts at the saved default.
  const formatInitialized = useRef(false);
  useEffect(() => {
    if (settings && !formatInitialized.current) {
      formatInitialized.current = true;
      setFormat(settings.qualityMode);
    }
  }, [settings]);

  const visible = useMemo(() => jobs.filter((job) => inView(job, view)), [jobs, view]);
  const selected = useMemo(
    () =>
      visible.find((job) => job.jobId === selectedId) ??
      visible.find(needsReview) ??
      visible[0] ??
      null,
    [visible, selectedId]
  );

  // If the failed view empties, go back to all downloads.
  useEffect(() => {
    if (view === "failed" && !jobs.some((job) => inView(job, "failed"))) {
      setView("all");
    }
  }, [jobs, view]);

  const submit = useCallback(
    async (link: string, mode: QualityMode = format, trimClip: boolean = trim) => {
      const trimmed = link.trim();
      if (!looksLikeUrl(trimmed)) {
        showToast("That doesn't look like a link. Copy the address from YouTube and paste it here.");
        return;
      }
      const job = await startDownload(trimmed, mode, trimClip);
      if (job) {
        setUrl("");
        setView((current) => (current === "all" || current === "active" ? current : "all"));
        setSelectedId(job.jobId);
      }
    },
    [format, trim, showToast, startDownload]
  );

  const changeFormat = useCallback(
    (mode: QualityMode) => {
      setFormat(mode);
      changeSettings({ qualityMode: mode });
    },
    [changeSettings]
  );

  // Paste a link anywhere in the window to fill the link field.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isTypingTarget(event.target) || settingsOpen) {
        return;
      }
      const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (looksLikeUrl(text)) {
        event.preventDefault();
        setUrl(text);
        urlInput.current?.focus();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [settingsOpen]);

  // Menu commands from the main process.
  useEffect(() => {
    if (!bridge) {
      return undefined;
    }
    const offSettings = bridge.onOpenSettings(() => setSettingsOpen(true));
    const offPaste = bridge.onPasteAndRip(() => {
      void bridge.readClipboard().then((text) => {
        if (looksLikeUrl(text)) {
          void submit(text);
        } else {
          showToast("Your clipboard doesn't have a link in it.");
        }
      });
    });
    return () => {
      offSettings();
      offPaste();
    };
  }, [submit, showToast]);

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    const text = (event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain")).split("\n")[0]?.trim() ?? "";
    if (looksLikeUrl(text)) {
      void submit(text);
    }
  };

  const applyMetadata = useCallback(
    async (job: ExtractionJobRecord, candidate: MetadataCandidate) => {
      if (!bridge) {
        return;
      }
      try {
        await bridge.chooseMetadata({ jobId: job.jobId, candidate });
        showToast(job.status === "completed" ? "Tags updated." : "Saved to your library.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The tags could not be saved.");
      }
    },
    [showToast]
  );

  const loadTrimSource = useCallback((jobId: string) => bridge!.trimSource(jobId), []);

  const applyTrim = useCallback(
    async (job: ExtractionJobRecord, range: TrimRange | undefined) => {
      if (!bridge) {
        return;
      }
      try {
        await bridge.applyTrim({ jobId: job.jobId, range });
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The clip could not be saved.");
      }
    },
    [showToast]
  );

  const reveal = useCallback(
    async (job: ExtractionJobRecord) => {
      if (!bridge || !job.outputPath) {
        return;
      }
      const result = await bridge.showItem(job.outputPath);
      if (!result.ok && result.message) {
        showToast(result.message);
      }
    },
    [showToast]
  );

  if (!bridge) {
    return (
      <main className="fatal">
        <h1>The app didn't finish loading</h1>
        <p>Quit and reopen it. If this keeps happening, report it on GitHub with your operating system version.</p>
      </main>
    );
  }

  return (
    <div
      className={`app${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <Sidebar
        jobs={jobs}
        view={view}
        onViewChange={setView}
        settings={settings}
        preflight={preflight}
        onOpenFolder={() => settings && void bridge.openFolder(settings.outputRoot)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="main">
        <div className="titlebar" onDoubleClick={(event) => event.target === event.currentTarget && void bridge.toggleWindowMaximize()}>
          <Toolbar
            ref={urlInput}
            url={url}
            onUrlChange={setUrl}
            format={format}
            onFormatChange={changeFormat}
            trim={trim}
            onTrimChange={setTrim}
            onSubmit={() => void submit(url)}
            pasteShortcut={isMac ? "⌘V" : "Ctrl+V"}
          />
        </div>
        <div className="content">
          <JobList
            view={view}
            jobs={visible}
            selectedId={selected?.jobId ?? null}
            onSelect={setSelectedId}
            onRemove={ripper.removeJob}
            onClearFinished={ripper.clearFinished}
            pasteShortcut={PASTE_SHORTCUT}
          />
          <Inspector
            job={selected}
            threshold={settings?.metadataAutoSelectThreshold ?? 0.86}
            revealLabel={REVEAL_LABEL}
            onApplyMetadata={applyMetadata}
            loadTrimSource={loadTrimSource}
            onApplyTrim={applyTrim}
            onCancel={(job) => void bridge.cancelJob(job.jobId)}
            onRetry={(job) => void submit(job.request.url, job.request.qualityMode, Boolean(job.request.trim))}
            onRemove={ripper.removeJob}
            onReveal={(job) => void reveal(job)}
            onMessage={showToast}
          />
        </div>
      </div>

      {dragging ? <div className="drop-hint">Drop the link to download it</div> : null}

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.actionLabel ? (
            <button type="button" className="toast-action" onClick={toast.onAction}>
              {toast.actionLabel}
            </button>
          ) : (
            <button type="button" className="toast-close" onClick={dismissToast} aria-label="Dismiss">
              ×
            </button>
          )}
        </div>
      ) : null}

      {settingsOpen && settings ? (
        <SettingsSheet
          bridge={bridge}
          settings={settings}
          preflight={preflight}
          onChange={changeSettings}
          onPreflight={ripper.setPreflight}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
