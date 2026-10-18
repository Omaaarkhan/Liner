import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { ExtractionJobRecord, MetadataCandidate, TrackMetadata } from "@audio-ripper/shared";
import { fileName, sourceLabel } from "../lib/jobs";
import { ImageIcon } from "./Icons";

type ArtworkChoice = "match" | "video" | "custom" | "none";

interface ReviewFormProps {
  job: ExtractionJobRecord;
  threshold: number;
  mode: "review" | "edit";
  onApply: (candidate: MetadataCandidate) => Promise<void>;
  onCancel: () => void;
  onMessage: (message: string) => void;
}

interface FieldDef {
  key: keyof TrackMetadata;
  label: string;
  numeric?: boolean;
}

const MAIN_FIELDS: FieldDef[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "trackNumber", label: "Track", numeric: true },
  { key: "year", label: "Year", numeric: true }
];

const MORE_FIELDS: FieldDef[] = [
  { key: "albumArtist", label: "Album artist" },
  { key: "discNumber", label: "Disc", numeric: true },
  { key: "genre", label: "Genre" }
];

function valueOf(meta: TrackMetadata | undefined, key: keyof TrackMetadata): string {
  const value = meta?.[key];
  if (value === undefined || value === null || value === "Unknown Album") {
    return "";
  }
  return String(value);
}

function initialCandidateIndex(job: ExtractionJobRecord): number {
  const candidates = job.metadataCandidates ?? [];
  if (job.selectedMetadata) {
    const index = candidates.findIndex(
      (candidate) => candidate.metadata.title === job.selectedMetadata?.title && candidate.metadata.album === job.selectedMetadata?.album
    );
    if (index >= 0) {
      return index;
    }
  }
  return 0;
}

/**
 * The review step: compares what the video title says with the chosen match,
 * lets the user edit the result, and picks the cover art.
 */
export function ReviewForm({ job, threshold, mode, onApply, onCancel, onMessage }: ReviewFormProps) {
  const candidates = job.metadataCandidates ?? [];
  const [index, setIndex] = useState(() => initialCandidateIndex(job));
  const candidate = candidates[index];
  const [draft, setDraft] = useState<TrackMetadata>(() => ({ ...(job.selectedMetadata ?? candidate?.metadata ?? { title: "", artist: "", album: "" }) }));
  const [artwork, setArtwork] = useState<ArtworkChoice>(candidate?.coverArtUrl ? "match" : job.videoInfo?.thumbnail ? "video" : "none");
  const [customArt, setCustomArt] = useState<string | undefined>();
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isFirstRender = useRef(true);

  // Picking another candidate resets the fields and artwork to that candidate.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!candidate) {
      return;
    }
    setDraft({ ...candidate.metadata });
    setArtwork(candidate.coverArtUrl && candidate.source === "musicbrainz" ? "match" : job.videoInfo?.thumbnail ? "video" : "none");
  }, [index]);

  const fromVideo = useMemo(() => candidates.find((item) => item.source === "youtube")?.metadata, [candidates]);
  const best = candidates[0];
  const score = candidate?.score ?? 0;

  function update(field: FieldDef, value: string): void {
    setDraft((current) => {
      if (field.numeric) {
        const numeric = value.trim() ? Number(value) : undefined;
        return { ...current, [field.key]: Number.isFinite(numeric) ? numeric : undefined };
      }
      return { ...current, [field.key]: value };
    });
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      onMessage("Choose a JPEG or PNG image for the cover.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    }).catch(() => "");
    if (!dataUrl) {
      onMessage("That image could not be read.");
      return;
    }
    setCustomArt(dataUrl);
    setArtwork("custom");
  }

  async function apply(): Promise<void> {
    if (!candidate) {
      return;
    }
    setSaving(true);
    try {
      await onApply({
        ...candidate,
        coverArtUrl: artwork === "match" ? candidate.coverArtUrl : artwork === "video" ? job.videoInfo?.thumbnail : undefined,
        coverArtDataUrl: artwork === "custom" ? customArt : undefined,
        metadata: {
          ...draft,
          title: draft.title || candidate.metadata.title,
          artist: draft.artist || candidate.metadata.artist,
          album: draft.album || candidate.metadata.album
        }
      });
    } finally {
      setSaving(false);
    }
  }

  const matchArt = candidate?.source === "musicbrainz" ? candidate.coverArtUrl : undefined;
  const extension = job.request.qualityMode === "mp3_320_export" ? "mp3" : job.videoInfo?.selectedFormat.ext ?? "m4a";
  const trackPrefix = draft.trackNumber ? `${String(draft.trackNumber).padStart(2, "0")} - ` : "";
  const destination = `${draft.artist || "Unknown Artist"}/${draft.album || "Unknown Album"}/${trackPrefix}${draft.title || "Untitled"}.${extension}`;

  const renderRow = (field: FieldDef) => {
    const before = valueOf(fromVideo, field.key);
    const after = valueOf(draft, field.key);
    const changed = before !== after;
    return (
      <tr key={field.key} className={changed ? "is-changed" : undefined}>
        <th scope="row">{field.label}</th>
        <td className="from-video">{before || <span className="none">none</span>}</td>
        <td>
          <input
            id={`field-${field.key}`}
            aria-label={field.label}
            value={after}
            inputMode={field.numeric ? "numeric" : undefined}
            onChange={(event) => update(field, event.target.value)}
          />
        </td>
      </tr>
    );
  };

  return (
    <div className="review">
      {mode === "review" && best ? (
        <div className={`confidence${score >= threshold ? " is-good" : ""}`}>
          <div className="meter" aria-hidden="true">
            <i style={{ width: `${Math.round(score * 100)}%` }} />
            <b style={{ left: `${Math.round(threshold * 100)}%` }} />
          </div>
          <p>
            {Math.round(score * 100)}% match. You asked to review anything under {Math.round(threshold * 100)}%.
          </p>
        </div>
      ) : null}

      {candidates.length > 1 ? (
        <fieldset className="candidates">
          <legend>Matches</legend>
          {candidates.slice(0, 5).map((item, i) => (
            <label key={`${item.source}-${item.metadata.mbid ?? i}`} className={`candidate${i === index ? " is-on" : ""}`}>
              <input type="radio" name="candidate" checked={i === index} onChange={() => setIndex(i)} />
              <span className="candidate-text">
                <span>{item.source === "youtube" ? "Use the video title" : `${valueOf(item.metadata, "album") || item.metadata.title}${item.metadata.year ? ` (${item.metadata.year})` : ""}`}</span>
                <small>
                  {sourceLabel(item)}
                  {item.source === "musicbrainz" ? `, ${item.metadata.artist}` : ""}
                </small>
              </span>
              <span className="candidate-score">{Math.round(item.score * 100)}%</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <table className="diff">
        <thead>
          <tr>
            <td />
            <th scope="col">From the video</th>
            <th scope="col">Will be saved as</th>
          </tr>
        </thead>
        <tbody>
          {MAIN_FIELDS.map(renderRow)}
          {showMore ? MORE_FIELDS.map(renderRow) : null}
        </tbody>
      </table>
      <button type="button" className="link-button" onClick={() => setShowMore((value) => !value)}>
        {showMore ? "Fewer fields" : "More fields"}
      </button>

      {job.request.embedArtwork ? (
        <div className="artwork">
          <span className="field-label">Cover</span>
          <div className="artwork-options" role="radiogroup" aria-label="Cover art">
            {matchArt ? (
              <button type="button" role="radio" aria-checked={artwork === "match"} className="art-option" onClick={() => setArtwork("match")}>
                <img src={matchArt} alt="" />
                <span>Album cover</span>
              </button>
            ) : null}
            {job.videoInfo?.thumbnail ? (
              <button type="button" role="radio" aria-checked={artwork === "video"} className="art-option" onClick={() => setArtwork("video")}>
                <img src={job.videoInfo.thumbnail} alt="" />
                <span>Video frame</span>
              </button>
            ) : null}
            <button
              type="button"
              role="radio"
              aria-checked={artwork === "custom"}
              className="art-option"
              onClick={() => (customArt ? setArtwork("custom") : fileInput.current?.click())}
            >
              {customArt ? <img src={customArt} alt="" /> : <span className="art-empty"><ImageIcon /></span>}
              <span>{customArt ? "Your image" : "Choose…"}</span>
            </button>
            <button type="button" role="radio" aria-checked={artwork === "none"} className="art-option" onClick={() => setArtwork("none")}>
              <span className="art-empty">None</span>
              <span>No cover</span>
            </button>
          </div>
          <input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg" tabIndex={-1} onChange={(event) => void handleFile(event)} />
        </div>
      ) : null}

      <p className="destination" title={destination}>
        Saves as {mode === "edit" && job.outputPath ? fileName(destination) : destination}
      </p>

      <div className="actions">
        <button type="button" className="button" onClick={onCancel}>
          {mode === "review" ? "Cancel download" : "Cancel"}
        </button>
        <button type="button" className="button primary" disabled={saving || !candidate} onClick={() => void apply()}>
          {saving ? "Saving…" : mode === "review" ? "Save to library" : "Save tags"}
        </button>
      </div>
    </div>
  );
}
