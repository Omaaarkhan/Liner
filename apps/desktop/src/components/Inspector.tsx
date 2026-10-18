import { useEffect, useRef, useState } from "react";
import type { ExtractionJobRecord, MetadataCandidate } from "@audio-ripper/shared";
import {
  audioSummary,
  displaySubtitle,
  displayTitle,
  fileName,
  isCancelable,
  isVideo,
  progressLine,
  stageNames,
  statusInfo
} from "../lib/jobs";
import { ChevronIcon, CopyIcon } from "./Icons";
import { Thumb } from "./JobList";
import { ReviewForm } from "./ReviewForm";

interface InspectorProps {
  job: ExtractionJobRecord | null;
  threshold: number;
  revealLabel: string;
  onApplyMetadata: (job: ExtractionJobRecord, candidate: MetadataCandidate) => Promise<void>;
  onCancel: (job: ExtractionJobRecord) => void;
  onRetry: (job: ExtractionJobRecord) => void;
  onRemove: (job: ExtractionJobRecord) => void;
  onReveal: (job: ExtractionJobRecord) => void;
  onMessage: (message: string) => void;
}

function LogDisclosure({ job, onMessage }: { job: ExtractionJobRecord; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(job.status === "failed");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [open, job.logs.length]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(job.logs.join("\n"));
      onMessage("Log copied.");
    } catch {
      onMessage("The log could not be copied.");
    }
  }

  return (
    <div className="log">
      <div className="log-head">
        <button type="button" className="disclosure" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <ChevronIcon className="disclosure-icon" />
          Log
          <span className="muted">{job.logs.length > 0 ? `${job.logs.length} lines` : "empty"}</span>
        </button>
        {open && job.logs.length > 0 ? (
          <button type="button" className="icon-button" onClick={() => void copy()} title="Copy log">
            <CopyIcon />
            <span className="visually-hidden">Copy log</span>
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="log-lines">
          {job.logs.map((line, index) => (
            <div key={index}>{line}</div>
          ))}
          <div ref={endRef} />
        </div>
      ) : null}
    </div>
  );
}

function Progress({ job }: { job: ExtractionJobRecord }) {
  const status = statusInfo(job);
  const names = stageNames(job);
  const fraction = job.progress?.fraction;
  return (
    <div className="progress-block">
      <ol className="steps">
        {names.map((name, index) => (
          <li key={name} className={index < status.stage ? "is-done" : index === status.stage ? "is-current" : undefined}>
            {name}
          </li>
        ))}
      </ol>
      {status.stage === 1 && fraction !== undefined ? (
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
          <i style={{ transform: `scaleX(${fraction})` }} />
        </div>
      ) : (
        <div className="bar is-indeterminate" role="progressbar" aria-label={status.label}>
          <i />
        </div>
      )}
      <p className="muted">{progressLine(job) || `${status.label}…`}</p>
    </div>
  );
}

function Details({ job }: { job: ExtractionJobRecord }) {
  const rows: Array<[string, string]> = [];
  const summary = audioSummary(job);
  if (summary) {
    rows.push([isVideo(job) ? "Format" : "Audio", summary]);
  }
  const meta = job.selectedMetadata;
  if (meta && !isVideo(job)) {
    if (meta.album) rows.push(["Album", meta.album]);
    if (meta.trackNumber) rows.push(["Track", String(meta.trackNumber)]);
    if (meta.year) rows.push(["Year", String(meta.year)]);
    if (meta.genre) rows.push(["Genre", meta.genre]);
  }
  if (job.outputPath) {
    rows.push(["File", fileName(job.outputPath)]);
  }
  rows.push(["Added", new Date(job.createdAt).toLocaleString()]);

  return (
    <dl className="details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Inspector({ job, threshold, revealLabel, onApplyMetadata, onCancel, onRetry, onRemove, onReveal, onMessage }: InspectorProps) {
  const [editing, setEditing] = useState(false);

  useEffect(() => setEditing(false), [job?.jobId]);

  if (!job) {
    return (
      <aside className="inspector is-empty">
        <p className="muted">Select a download to see its details.</p>
      </aside>
    );
  }

  const status = statusInfo(job);
  const running = status.stage >= 0;
  const reviewing = job.status === "awaiting_user_choice" && !isVideo(job);
  const canEditTags = job.status === "completed" && !isVideo(job) && Boolean(job.outputPath) && (job.metadataCandidates?.length ?? 0) > 0;

  return (
    <aside className="inspector" aria-label="Details">
      <header className="inspector-head">
        <Thumb job={job} size="large" />
        <div className="inspector-title">
          <h2>{displayTitle(job)}</h2>
          <p className="muted">{displaySubtitle(job)}</p>
          {job.videoInfo?.webpageUrl ? (
            <a className="source-link" href={job.videoInfo.webpageUrl} target="_blank" rel="noreferrer" title={job.videoInfo.title}>
              From “{job.videoInfo.title}”
            </a>
          ) : (
            <span className="source-link">{job.request.url}</span>
          )}
        </div>
      </header>

      <div className="inspector-body">
        {running ? <Progress job={job} /> : null}

        {job.status === "failed" ? (
          <div className="notice tone-bad">
            <strong>This download failed.</strong>
            <p>{job.error ?? "yt-dlp stopped without saying why. The log below has the details."}</p>
          </div>
        ) : null}

        {reviewing || editing ? (
          <ReviewForm
            key={`${job.jobId}-${editing ? "edit" : "review"}`}
            job={job}
            threshold={threshold}
            mode={reviewing ? "review" : "edit"}
            onApply={async (candidate) => {
              await onApplyMetadata(job, candidate);
              setEditing(false);
            }}
            onCancel={() => (reviewing ? onCancel(job) : setEditing(false))}
            onMessage={onMessage}
          />
        ) : null}

        {!running && !reviewing && !editing && job.status !== "failed" ? <Details job={job} /> : null}

        {job.warnings.length > 0 && job.status === "completed" ? (
          <ul className="warnings">
            {job.warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        ) : null}

        <LogDisclosure job={job} onMessage={onMessage} />
      </div>

      {!reviewing && !editing ? (
        <footer className="actions">
          {running && isCancelable(job) ? (
            <button type="button" className="button" onClick={() => onCancel(job)}>
              Cancel download
            </button>
          ) : null}
          {!running ? (
            <button type="button" className="button ghost" onClick={() => onRemove(job)}>
              Remove
            </button>
          ) : null}
          {canEditTags ? (
            <button type="button" className="button" onClick={() => setEditing(true)}>
              Edit tags
            </button>
          ) : null}
          {job.status === "failed" || job.status === "cancelled" ? (
            <button type="button" className="button primary" onClick={() => onRetry(job)}>
              Try again
            </button>
          ) : null}
          {job.status === "completed" ? (
            <button type="button" className="button primary" onClick={() => onReveal(job)}>
              {revealLabel}
            </button>
          ) : null}
        </footer>
      ) : null}
    </aside>
  );
}
