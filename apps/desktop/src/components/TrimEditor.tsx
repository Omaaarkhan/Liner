import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ExtractionJobRecord, TrimRange, TrimSource } from "@audio-ripper/shared";
import { formatClock, isVideo, parseClock } from "../lib/jobs";
import { PauseIcon, PlayIcon } from "./Icons";

/** Matches MIN_TRIM_SECONDS in the core. */
const MIN_LENGTH = 0.5;
const BAR_PITCH = 3;

interface TrimEditorProps {
  job: ExtractionJobRecord;
  loadSource: (jobId: string) => Promise<TrimSource>;
  onApply: (range: TrimRange | undefined) => Promise<void>;
  onCancel: () => void;
}

type DragMode = "start" | "end" | "move" | "seek";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Folds the peaks down to one bar per BAR_PITCH pixels, keeping the loudest of each group. */
function barsFor(peaks: number[], width: number): number[] {
  const count = Math.max(24, Math.floor(width / BAR_PITCH));
  if (peaks.length <= count) {
    return peaks;
  }
  const bars = new Array<number>(count).fill(0);
  peaks.forEach((value, index) => {
    const bar = Math.floor((index * count) / peaks.length);
    bars[bar] = Math.max(bars[bar] ?? 0, value);
  });
  return bars;
}

/** A centred bar for each value, drawn in a 0..count by 0..100 box. */
function wavePath(bars: number[]): string {
  return bars
    .map((value, index) => {
      const height = Math.max(3, value * 92);
      return `M${index + 0.18} ${50 - height / 2}h0.64v${height}h-0.64z`;
    })
    .join("");
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (seconds: number) => void }) {
  const [text, setText] = useState(formatClock(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setText(formatClock(value));
    }
  }, [value, editing]);

  const commit = (): void => {
    setEditing(false);
    const parsed = parseClock(text);
    if (parsed === undefined) {
      setText(formatClock(value));
    } else {
      onCommit(parsed);
    }
  };

  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        value={text}
        inputMode="decimal"
        spellCheck={false}
        onFocus={(event) => {
          setEditing(true);
          event.currentTarget.select();
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setText(formatClock(value));
            setEditing(false);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function TrimEditor({ job, loadSource, onApply, onCancel }: TrimEditorProps) {
  const video = isVideo(job);
  const [source, setSource] = useState<TrimSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<TrimRange>({ start: 0, end: job.videoInfo?.duration ?? 0 });
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState<"clip" | "whole" | null>(null);
  const [width, setWidth] = useState(320);
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  // Audio-only downloads show a muted YouTube stream as the picture, kept in step with the audio.
  const pictureRef = useRef<HTMLVideoElement>(null);
  const [pictureFailed, setPictureFailed] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: DragMode; offset: number; originX: number; moved: boolean } | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const duration = source?.duration || job.videoInfo?.duration || 0;

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setLoadError(null);
    loadSource(job.jobId)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setSource(loaded);
        setRange({ start: 0, end: loaded.duration });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "The download could not be read.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [job.jobId, loadSource]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(track);
    return () => observer.disconnect();
  }, [source]);

  useEffect(() => () => window.cancelAnimationFrame(frame.current ?? 0), []);

  const bars = useMemo(() => (source ? barsFor(source.peaks, width) : []), [source, width]);
  const path = useMemo(() => wavePath(bars), [bars]);

  const seek = useCallback((seconds: number) => {
    setPlayhead(seconds);
    const media = mediaRef.current;
    if (media && Number.isFinite(seconds)) {
      media.currentTime = seconds;
    }
    if (pictureRef.current && Number.isFinite(seconds)) {
      pictureRef.current.currentTime = seconds;
    }
  }, []);

  const pause = useCallback(() => {
    mediaRef.current?.pause();
    pictureRef.current?.pause();
    window.cancelAnimationFrame(frame.current ?? 0);
    setPlaying(false);
  }, []);

  // Playback follows the media clock and stops at the end handle.
  const tick = useCallback(() => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    if (media.currentTime >= rangeRef.current.end || media.ended) {
      pause();
      seek(rangeRef.current.start);
      return;
    }
    setPlayhead(media.currentTime);
    const picture = pictureRef.current;
    if (picture && Math.abs(picture.currentTime - media.currentTime) > 0.3) {
      picture.currentTime = media.currentTime;
    }
    frame.current = window.requestAnimationFrame(tick);
  }, [pause, seek]);

  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    if (playing) {
      pause();
      return;
    }
    const { start, end } = rangeRef.current;
    const from = playhead >= start && playhead < end - 0.05 ? playhead : start;
    media.currentTime = from;
    if (pictureRef.current) {
      pictureRef.current.currentTime = from;
      void pictureRef.current.play().catch(() => undefined);
    }
    void media.play().then(() => {
      setPlaying(true);
      frame.current = window.requestAnimationFrame(tick);
    }).catch(() => setPlaying(false));
  }, [pause, playhead, playing, tick]);

  const setStart = useCallback(
    (seconds: number) => {
      const start = clamp(seconds, 0, rangeRef.current.end - MIN_LENGTH);
      setRange((current) => ({ ...current, start }));
      if (!playing) {
        seek(start);
      }
    },
    [playing, seek]
  );

  const setEnd = useCallback(
    (seconds: number) => {
      const end = clamp(seconds, rangeRef.current.start + MIN_LENGTH, duration);
      setRange((current) => ({ ...current, end }));
      if (!playing) {
        seek(end);
      }
    },
    [duration, playing, seek]
  );

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return 0;
    }
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !duration) {
      return;
    }
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle as DragMode | undefined;
    const at = timeAt(event.clientX);
    const mode: DragMode = handle ?? (target.closest(".trim-selection") && !event.altKey ? "move" : "seek");
    drag.current = { mode, offset: at - range.start, originX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "seek") {
      seek(at);
    } else if (handle) {
      (target.closest<HTMLElement>("[data-handle]") ?? target).focus();
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current) {
      return;
    }
    const at = timeAt(event.clientX);
    // A click inside the kept part seeks; it only becomes a move once the pointer travels.
    if (!current.moved && Math.abs(event.clientX - current.originX) < 3) {
      return;
    }
    current.moved = true;
    if (current.mode === "start") {
      setStart(at);
    } else if (current.mode === "end") {
      setEnd(at);
    } else if (current.mode === "move") {
      const length = range.end - range.start;
      const start = clamp(at - current.offset, 0, duration - length);
      setRange({ start, end: start + length });
      if (!playing) {
        seek(start);
      }
    } else {
      seek(at);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.mode === "move" && !drag.current.moved) {
      seek(timeAt(event.clientX));
    }
    drag.current = null;
  };

  const nudge = (which: "start" | "end") => (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 0.1;
    const current = which === "start" ? range.start : range.end;
    const set = which === "start" ? setStart : setEnd;
    const next =
      event.key === "ArrowLeft" || event.key === "ArrowDown" ? current - step
      : event.key === "ArrowRight" || event.key === "ArrowUp" ? current + step
      : event.key === "Home" ? 0
      : event.key === "End" ? duration
      : undefined;
    if (next !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      set(next);
    }
  };

  // Editor shortcuts: Space plays, I and O set the handles at the playhead.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      togglePlay();
    } else if (event.key.toLowerCase() === "i") {
      setStart(playhead);
    } else if (event.key.toLowerCase() === "o") {
      setEnd(playhead);
    }
  };

  async function apply(whole: boolean): Promise<void> {
    pause();
    setSaving(whole ? "whole" : "clip");
    try {
      await onApply(whole ? undefined : range);
    } finally {
      setSaving(null);
    }
  }

  const pct = (seconds: number): string => `${duration ? (seconds / duration) * 100 : 0}%`;
  const length = range.end - range.start;
  const untouched = range.start <= 0.05 && range.end >= duration - 0.05;

  return (
    <div className="trim" onKeyDown={onKeyDown}>
      {video ? (
        <div className="trim-preview">
          {source ? (
            <video ref={mediaRef} src={source.mediaUrl} preload="auto" playsInline onClick={togglePlay} onPause={() => setPlaying(false)} />
          ) : job.videoInfo?.thumbnail ? (
            <img src={job.videoInfo.thumbnail} alt="" />
          ) : null}
        </div>
      ) : source ? (
        <>
          {source.previewUrl && !pictureFailed ? (
            <div className="trim-preview">
              <video
                ref={pictureRef}
                src={source.previewUrl}
                poster={job.videoInfo?.thumbnail}
                muted
                preload="auto"
                playsInline
                onClick={togglePlay}
                onError={() => setPictureFailed(true)}
                // A seek swaps the poster for the frame at the playhead.
                onLoadedData={(event) => {
                  event.currentTarget.currentTime = mediaRef.current?.currentTime ?? 0;
                }}
              />
            </div>
          ) : null}
          <audio ref={mediaRef} src={source.mediaUrl} preload="auto" onPause={() => setPlaying(false)} />
        </>
      ) : null}

      <div className="trim-intro">
        <h3>Choose the part to keep</h3>
        <p className="muted">Drag the edges, or type exact times. Only this part is saved.</p>
      </div>

      {loadError ? (
        <div className="notice tone-bad">
          <strong>The waveform could not be drawn.</strong>
          <p>{loadError} You can still keep the whole download.</p>
        </div>
      ) : (
        <div
          ref={trackRef}
          className={`trim-track${source ? "" : " is-loading"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {source ? (
            <>
              <svg className="trim-wave" viewBox={`0 0 ${Math.max(1, bars.length)} 100`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <clipPath id={`keep-${job.jobId}`}>
                    <rect x={duration ? (range.start / duration) * bars.length : 0} y="0" width={duration ? (length / duration) * bars.length : bars.length} height="100" />
                  </clipPath>
                </defs>
                <path className="wave-out" d={path} />
                <path className="wave-in" d={path} clipPath={`url(#keep-${job.jobId})`} />
              </svg>
              <div className="trim-shade" style={{ left: 0, width: pct(range.start) }} />
              <div className="trim-shade" style={{ left: pct(range.end), right: 0 }} />
              <div className="trim-selection" style={{ left: pct(range.start), width: pct(length) }}>
                <div
                  className="trim-handle is-start"
                  data-handle="start"
                  role="slider"
                  tabIndex={0}
                  aria-label="Start"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration * 10) / 10}
                  aria-valuenow={Math.round(range.start * 10) / 10}
                  aria-valuetext={formatClock(range.start)}
                  onKeyDown={nudge("start")}
                />
                <div
                  className="trim-handle is-end"
                  data-handle="end"
                  role="slider"
                  tabIndex={0}
                  aria-label="End"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration * 10) / 10}
                  aria-valuenow={Math.round(range.end * 10) / 10}
                  aria-valuetext={formatClock(range.end)}
                  onKeyDown={nudge("end")}
                />
              </div>
              <div className="trim-playhead" style={{ left: pct(playhead) }} />
            </>
          ) : (
            <span className="muted">Reading the audio…</span>
          )}
        </div>
      )}

      {source ? (
        <div className="trim-controls">
          <button type="button" className="play-button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play selection"} title="Space">
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span className="trim-clock" aria-live="off">
            {formatClock(playhead)}
          </span>
          <span className="trim-shortcuts muted">
            <button type="button" className="link-button" onClick={() => setStart(playhead)} title="I">
              Start here
            </button>
            <button type="button" className="link-button" onClick={() => setEnd(playhead)} title="O">
              End here
            </button>
          </span>
        </div>
      ) : null}

      {source ? (
        <div className="trim-times">
          <TimeField label="Start" value={range.start} onCommit={setStart} />
          <div className="trim-length">
            <span>Length</span>
            <output>{formatClock(length)}</output>
          </div>
          <TimeField label="End" value={range.end} onCommit={setEnd} />
        </div>
      ) : null}

      <div className="actions">
        <button type="button" className="button ghost" onClick={onCancel} disabled={saving !== null} title="Cancel download">
          Cancel
        </button>
        <button type="button" className="button" onClick={() => void apply(true)} disabled={saving !== null}>
          {saving === "whole" ? "Saving…" : "Keep whole"}
        </button>
        <button type="button" className="button primary" onClick={() => void apply(false)} disabled={saving !== null || !source || untouched}>
          {saving === "clip" ? "Saving…" : "Save clip"}
        </button>
      </div>
    </div>
  );
}
