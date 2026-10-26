import { forwardRef } from "react";
import type { QualityMode } from "@audio-ripper/shared";
import { FORMAT_DESCRIPTIONS, FORMAT_LABELS } from "../lib/jobs";
import { LinkIcon, ScissorsIcon } from "./Icons";

interface ToolbarProps {
  url: string;
  onUrlChange: (url: string) => void;
  format: QualityMode;
  onFormatChange: (format: QualityMode) => void;
  trim: boolean;
  onTrimChange: (trim: boolean) => void;
  onSubmit: () => void;
  pasteShortcut: string;
}

const FORMATS: QualityMode[] = ["source_fidelity", "mp3_320_export", "video_mp4"];

export const Toolbar = forwardRef<HTMLInputElement, ToolbarProps>(function Toolbar(
  { url, onUrlChange, format, onFormatChange, trim, onTrimChange, onSubmit, pasteShortcut },
  inputRef
) {
  return (
    <form
      className="toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="url-field">
        <LinkIcon className="url-icon" />
        <span className="visually-hidden">YouTube link</span>
        <input
          ref={inputRef}
          id="url"
          type="url"
          value={url}
          spellCheck={false}
          autoComplete="off"
          placeholder="Paste a YouTube link"
          onChange={(event) => onUrlChange(event.target.value)}
        />
        {!url ? <kbd className="url-hint">{pasteShortcut}</kbd> : null}
      </label>

      <div className="segmented" role="radiogroup" aria-label="Format">
        {FORMATS.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={format === mode}
            className={format === mode ? "is-on" : undefined}
            title={FORMAT_DESCRIPTIONS[mode]}
            onClick={() => onFormatChange(mode)}
          >
            {FORMAT_LABELS[mode]}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`toggle${trim ? " is-on" : ""}`}
        aria-pressed={trim}
        title={trim ? "Downloads wait for you to pick the part to keep" : "Pick the part to keep before saving"}
        onClick={() => onTrimChange(!trim)}
      >
        <ScissorsIcon />
        Trim
      </button>

      <button type="submit" className="button primary" disabled={!url.trim()}>
        Download
      </button>
    </form>
  );
});
