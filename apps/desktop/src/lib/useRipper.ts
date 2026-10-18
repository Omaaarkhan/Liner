import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExtractionJobRecord, JobEvent, PreflightReport, QualityMode, Settings } from "@audio-ripper/shared";
import type { RipperBridge } from "../vite-env";

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const UNDO_WINDOW_MS = 5000;

function sortJobs(list: ExtractionJobRecord[]): ExtractionJobRecord[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function upsert(list: ExtractionJobRecord[], job: ExtractionJobRecord): ExtractionJobRecord[] {
  const existing = list.find((item) => item.jobId === job.jobId);
  // Status events may arrive before a log batch for the same job; keep the longer log.
  const merged = existing && existing.logs.length > job.logs.length ? { ...job, logs: existing.logs, progress: job.progress ?? existing.progress } : job;
  return sortJobs([merged, ...list.filter((item) => item.jobId !== job.jobId)]);
}

/** All app state that comes from the main process, plus the actions that change it. */
export function useRipper(bridge: RipperBridge | undefined) {
  const [jobs, setJobs] = useState<ExtractionJobRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toastTimer = useRef<number | undefined>(undefined);
  const settingsTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string, action?: { label: string; run: () => void }) => {
    window.clearTimeout(toastTimer.current);
    const next: Toast = { id: Date.now(), message, actionLabel: action?.label, onAction: action?.run };
    setToast(next);
    toastTimer.current = window.setTimeout(() => setToast((current) => (current?.id === next.id ? null : current)), UNDO_WINDOW_MS);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!bridge) {
      return undefined;
    }
    let disposed = false;
    let unsubscribe: (() => Promise<void>) | undefined;

    const handleEvent = (event: JobEvent): void => {
      if (event.type === "job-status") {
        setJobs((current) => upsert(current, event.job));
      } else if (event.type === "job-log") {
        setJobs((current) =>
          current.map((job) => (job.jobId === event.jobId ? { ...job, logs: [...job.logs, ...event.lines].slice(-250) } : job))
        );
      } else if (event.type === "job-progress") {
        setJobs((current) => current.map((job) => (job.jobId === event.jobId ? { ...job, progress: event.progress } : job)));
      }
    };

    void bridge.subscribeJobEvents(handleEvent).then((handler) => {
      if (disposed) {
        void handler();
      } else {
        unsubscribe = handler;
      }
    });
    void bridge.listJobs().then((list) => !disposed && setJobs(sortJobs(list)));
    void bridge.getSettings().then((loaded) => !disposed && setSettings(loaded));
    void bridge.preflight().then((report) => !disposed && setPreflight(report));

    return () => {
      disposed = true;
      void unsubscribe?.();
    };
  }, [bridge]);

  const visibleJobs = useMemo(() => jobs.filter((job) => !hidden.has(job.jobId)), [jobs, hidden]);

  const startDownload = useCallback(
    async (url: string, qualityMode: QualityMode): Promise<ExtractionJobRecord | undefined> => {
      if (!bridge || !settings) {
        return undefined;
      }
      try {
        const job = await bridge.createJob({
          url,
          outputRoot: settings.outputRoot,
          qualityMode,
          embedArtwork: settings.embedArtwork,
          downloadSpeedProfile: settings.downloadSpeedProfile
        });
        setJobs((current) => upsert(current, job));
        return job;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not start the download.");
        return undefined;
      }
    },
    [bridge, settings, showToast]
  );

  /** Settings save on their own, shortly after the last change. */
  const changeSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((current) => {
        if (!current) {
          return current;
        }
        const next = { ...current, ...patch };
        window.clearTimeout(settingsTimer.current);
        settingsTimer.current = window.setTimeout(() => {
          void bridge?.updateSettings(next).catch(() => showToast("Settings could not be saved."));
        }, 300);
        return next;
      });
    },
    [bridge, showToast]
  );

  /** Hides jobs right away and removes them for real unless the user presses Undo. */
  const removeWithUndo = useCallback(
    (ids: string[], message: string, commit: () => Promise<ExtractionJobRecord[]>) => {
      setHidden((current) => new Set([...current, ...ids]));
      let undone = false;
      const timer = window.setTimeout(() => {
        if (undone) {
          return;
        }
        void commit().then((list) => {
          setJobs(sortJobs(list));
          setHidden((current) => {
            const next = new Set(current);
            ids.forEach((id) => next.delete(id));
            return next;
          });
        });
      }, UNDO_WINDOW_MS);
      showToast(message, {
        label: "Undo",
        run: () => {
          undone = true;
          window.clearTimeout(timer);
          setHidden((current) => {
            const next = new Set(current);
            ids.forEach((id) => next.delete(id));
            return next;
          });
          setToast(null);
        }
      });
    },
    [showToast]
  );

  const removeJob = useCallback(
    (job: ExtractionJobRecord) => {
      if (!bridge) {
        return;
      }
      removeWithUndo([job.jobId], "Removed from the list. The file stays on disk.", () => bridge.deleteJob(job.jobId));
    },
    [bridge, removeWithUndo]
  );

  const clearFinished = useCallback(() => {
    if (!bridge) {
      return;
    }
    const ids = jobs.filter((job) => ["completed", "failed", "cancelled"].includes(job.status)).map((job) => job.jobId);
    if (ids.length === 0) {
      return;
    }
    removeWithUndo(ids, `Cleared ${ids.length} finished ${ids.length === 1 ? "download" : "downloads"}.`, () => bridge.clearFinished());
  }, [bridge, jobs, removeWithUndo]);

  const refreshPreflight = useCallback(async () => {
    if (bridge) {
      setPreflight(await bridge.preflight(true));
    }
  }, [bridge]);

  return {
    jobs: visibleJobs,
    settings,
    preflight,
    toast,
    showToast,
    dismissToast,
    startDownload,
    changeSettings,
    removeJob,
    clearFinished,
    refreshPreflight,
    setPreflight
  };
}
