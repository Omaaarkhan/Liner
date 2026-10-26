import { memo, type KeyboardEvent } from "react";
import type { ExtractionJobRecord } from "@audio-ripper/shared";
import { audioSummary, displaySubtitle, displayTitle, formatDuration, isVideo, needsReview, progressLine, stageNames, statusInfo, VIEWS, type ViewId } from "../lib/jobs";
import { MusicIcon, VideoIcon } from "./Icons";

interface JobListProps {
  view: ViewId;
  jobs: ExtractionJobRecord[];
  selectedId: string | null;
  onSelect: (jobId: string) => void;
  onRemove: (job: ExtractionJobRecord) => void;
  onClearFinished: () => void;
  pasteShortcut: string;
}

export function Thumb({ job, size = "row" }: { job: ExtractionJobRecord; size?: "row" | "large" }) {
  const src = job.videoInfo?.thumbnail;
  const Fallback = isVideo(job) ? VideoIcon : MusicIcon;
  return (
    <div className={`thumb thumb-${size}`}>
      {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <Fallback />}
    </div>
  );
}

function StageBar({ job }: { job: ExtractionJobRecord }) {
  const { stage } = statusInfo(job);
  const names = stageNames(job);
  const fraction = job.progress?.fraction;
  return (
    <div className="stages" aria-label={`Step ${stage + 1} of ${names.length}: ${names[stage]}`}>
      {names.map((name, index) => {
        let fill = 0;
        if (index < stage) {
          fill = 1;
        } else if (index === stage) {
          fill = name === "Download" && fraction !== undefined ? fraction : 0.35;
        }
        return (
          <span key={name} className={`stage${index === stage && fraction === undefined ? " is-pulsing" : ""}`}>
            <i style={{ transform: `scaleX(${fill})` }} />
          </span>
        );
      })}
    </div>
  );
}

const JobRow = memo(function JobRow({
  job,
  selected,
  onSelect
}: {
  job: ExtractionJobRecord;
  selected: boolean;
  onSelect: (jobId: string) => void;
}) {
  const status = statusInfo(job);
  const running = status.stage >= 0;
  const detail = running ? progressLine(job) || status.label : job.status === "completed" ? audioSummary(job) : job.error ?? "";

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={`job-row${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(job.jobId)}
      data-job-id={job.jobId}
    >
      <Thumb job={job} />
      <div className="job-text">
        <div className="job-title">{displayTitle(job)}</div>
        <div className="job-subtitle">{displaySubtitle(job) || job.request.url}</div>
      </div>
      <div className="job-state">
        {running ? <StageBar job={job} /> : <span className={`pill tone-${status.tone}`}>{status.label}</span>}
        <span className="job-detail" title={detail}>{running ? detail : job.status === "awaiting_user_choice" ? bestMatchLabel(job) : job.status === "awaiting_trim" ? trimLabel(job) : detail}</span>
      </div>
    </div>
  );
});

function trimLabel(job: ExtractionJobRecord): string {
  const length = formatDuration(job.videoInfo?.duration);
  return length ? `Pick the part to keep from ${length}` : "Pick the part to keep";
}

function bestMatchLabel(job: ExtractionJobRecord): string {
  const best = job.metadataCandidates?.[0];
  return best ? `Best match ${Math.round(best.score * 100)}%` : "";
}

const EMPTY_COPY: Record<ViewId, { title: string; body: string }> = {
  all: { title: "Nothing downloaded yet", body: "Copy a YouTube link, then paste it anywhere in this window." },
  active: { title: "Nothing is downloading", body: "New downloads show their progress here." },
  review: { title: "Nothing needs review", body: "Downloads you asked to trim, and matches below your threshold, wait here for you." },
  finished: { title: "No finished downloads", body: "Saved files appear here with a link to their folder." },
  failed: { title: "No failed downloads", body: "Downloads that fail or are cancelled show up here." }
};

export function JobList({ view, jobs, selectedId, onSelect, onRemove, onClearFinished, pasteShortcut }: JobListProps) {
  const title = VIEWS.find((item) => item.id === view)?.label ?? "Downloads";
  const running = jobs.filter((job) => statusInfo(job).stage >= 0).length;
  const waiting = jobs.filter(needsReview).length;
  const summary = [running ? `${running} running` : "", waiting ? `${waiting} waiting for you` : ""].filter(Boolean).join(", ");
  const canClear = (view === "finished" || view === "failed" || view === "all") && jobs.some((job) => ["completed", "failed", "cancelled"].includes(job.status));

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = jobs.findIndex((job) => job.jobId === selectedId);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = jobs[Math.min(jobs.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        onSelect(next.jobId);
        (event.currentTarget.querySelector(`[data-job-id="${next.jobId}"]`) as HTMLElement | null)?.focus();
      }
    } else if ((event.key === "Backspace" || event.key === "Delete") && index >= 0) {
      const job = jobs[index];
      if (job && statusInfo(job).stage < 0) {
        event.preventDefault();
        onRemove(job);
      }
    }
  }

  return (
    <section className="list-pane" aria-label={title}>
      <header className="list-head">
        <h1>{title}</h1>
        <div className="list-head-side">
          {summary ? <span className="muted">{summary}</span> : null}
          {canClear ? (
            <button type="button" className="button ghost small" onClick={onClearFinished}>
              Clear finished
            </button>
          ) : null}
        </div>
      </header>

      {jobs.length === 0 ? (
        <div className="empty">
          <h2>{EMPTY_COPY[view].title}</h2>
          <p>{EMPTY_COPY[view].body}</p>
          {view === "all" ? <p className="muted">Shortcut: {pasteShortcut} pastes and starts in one step.</p> : null}
        </div>
      ) : (
        <div className="job-list" role="listbox" aria-label={title} onKeyDown={handleKeyDown}>
          {jobs.map((job) => (
            <JobRow key={job.jobId} job={job} selected={job.jobId === selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}
