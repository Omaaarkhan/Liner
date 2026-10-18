import { useEffect, useRef, useState } from "react";
import type { DownloadSpeedProfile, PreflightReport, QualityMode, Settings, ThemePreference } from "@audio-ripper/shared";
import type { RipperBridge } from "../vite-env";
import { FORMAT_DESCRIPTIONS, FORMAT_LABELS } from "../lib/jobs";

interface SettingsSheetProps {
  bridge: RipperBridge;
  settings: Settings;
  preflight: PreflightReport | null;
  onChange: (patch: Partial<Settings>) => void;
  onPreflight: (report: PreflightReport) => void;
  onClose: () => void;
}

const SPEEDS: Array<{ id: DownloadSpeedProfile; label: string; hint: string }> = [
  { id: "safe", label: "Gentle", hint: "One connection. Slowest, least likely to be throttled." },
  { id: "balanced", label: "Balanced", hint: "Four connections. Right for most people." },
  { id: "aggressive", label: "Fast", hint: "Eight connections. Fastest on good networks." }
];

const THEMES: Array<{ id: ThemePreference; label: string }> = [
  { id: "system", label: "Match system" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" }
];

const FORMATS: QualityMode[] = ["source_fidelity", "mp3_320_export", "video_mp4"];

export function SettingsSheet({ bridge, settings, preflight, onChange, onPreflight, onClose }: SettingsSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [updateMessage, setUpdateMessage] = useState<string>("");
  const [updating, setUpdating] = useState(false);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    void bridge.appInfo().then((info) => setVersion(info.version));
    return () => previous?.focus();
  }, [bridge]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function chooseFolder(): Promise<void> {
    const folder = await bridge.chooseFolder(settings.outputRoot);
    if (folder) {
      onChange({ outputRoot: folder });
    }
  }

  async function updateTools(): Promise<void> {
    setUpdating(true);
    setUpdateMessage("Checking GitHub for a newer yt-dlp…");
    const result = await bridge.updateYtDlp();
    setUpdateMessage(result.message ?? "");
    onPreflight(await bridge.preflight());
    setUpdating(false);
  }

  const threshold = Math.round(settings.metadataAutoSelectThreshold * 100);
  const ytdlp = preflight?.binaries.find((item) => item.name === "yt-dlp");
  const ffmpeg = preflight?.binaries.find((item) => item.name === "ffmpeg");

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={dialogRef}>
        <header className="sheet-head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="button small" onClick={onClose}>
            Done
          </button>
        </header>

        <div className="sheet-body">
          <section className="settings-group">
            <h3>Downloads</h3>
            <div className="setting">
              <span className="setting-label">Save to</span>
              <div className="setting-control folder-row">
                <span className="folder-path" title={settings.outputRoot}>{settings.outputRoot}</span>
                <button type="button" className="button small" onClick={() => void chooseFolder()}>
                  Change…
                </button>
              </div>
            </div>
            <div className="setting">
              <span className="setting-label">Default format</span>
              <div className="setting-control">
                <div className="segmented" role="radiogroup" aria-label="Default format">
                  {FORMATS.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={settings.qualityMode === mode}
                      className={settings.qualityMode === mode ? "is-on" : undefined}
                      onClick={() => onChange({ qualityMode: mode })}
                    >
                      {FORMAT_LABELS[mode]}
                    </button>
                  ))}
                </div>
                <p className="hint">{FORMAT_DESCRIPTIONS[settings.qualityMode]}</p>
              </div>
            </div>
            <div className="setting">
              <label className="setting-label" htmlFor="speed">Speed</label>
              <div className="setting-control">
                <select id="speed" value={settings.downloadSpeedProfile} onChange={(event) => onChange({ downloadSpeedProfile: event.target.value as DownloadSpeedProfile })}>
                  {SPEEDS.map((speed) => (
                    <option key={speed.id} value={speed.id}>{speed.label}</option>
                  ))}
                </select>
                <p className="hint">{SPEEDS.find((speed) => speed.id === settings.downloadSpeedProfile)?.hint}</p>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <h3>Tags</h3>
            <div className="setting">
              <label className="setting-label" htmlFor="threshold">Ask me to review</label>
              <div className="setting-control">
                <div className="slider-row">
                  <input
                    id="threshold"
                    type="range"
                    min={50}
                    max={100}
                    step={1}
                    value={threshold}
                    onChange={(event) => onChange({ metadataAutoSelectThreshold: Number(event.target.value) / 100 })}
                  />
                  <output htmlFor="threshold">{threshold}%</output>
                </div>
                <p className="hint">
                  {threshold >= 100
                    ? "Every song waits for you to confirm its tags."
                    : `Songs whose best match is below ${threshold}% wait for you. Better matches are tagged automatically.`}
                </p>
              </div>
            </div>
            <div className="setting">
              <span className="setting-label">Cover art</span>
              <div className="setting-control">
                <label className="check">
                  <input type="checkbox" id="embed-artwork" checked={settings.embedArtwork} onChange={(event) => onChange({ embedArtwork: event.target.checked })} />
                  Add cover art to audio files
                </label>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <h3>Appearance</h3>
            <div className="setting">
              <span className="setting-label">Theme</span>
              <div className="setting-control">
                <div className="segmented" role="radiogroup" aria-label="Theme">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      role="radio"
                      aria-checked={settings.theme === theme.id}
                      className={settings.theme === theme.id ? "is-on" : undefined}
                      onClick={() => onChange({ theme: theme.id })}
                    >
                      {theme.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <h3>Tools</h3>
            <div className="setting">
              <span className="setting-label">yt-dlp</span>
              <div className="setting-control">
                <p className={ytdlp?.available ? undefined : "tone-bad-text"}>
                  {ytdlp ? (ytdlp.available ? ytdlp.version?.replace(/^bundled:\s*/, "") : "Can't start") : "Checking…"}
                </p>
                <p className="hint">YouTube changes often. A newer yt-dlp is the usual fix when downloads start failing. It's checked once a day.</p>
                <div className="inline-actions">
                  <button type="button" className="button small" disabled={updating} onClick={() => void updateTools()}>
                    Check for update
                  </button>
                  {updateMessage ? <span className="muted">{updateMessage}</span> : null}
                </div>
              </div>
            </div>
            <div className="setting">
              <span className="setting-label">ffmpeg</span>
              <div className="setting-control">
                <p className={ffmpeg?.available ? undefined : "tone-bad-text"}>
                  {ffmpeg ? (ffmpeg.available ? (ffmpeg.version ?? "").replace(/^bundled:\s*/, "").replace(/ Copyright.*/, "") : "Can't start") : "Checking…"}
                </p>
                {ffmpeg && !ffmpeg.available ? <p className="hint">{ffmpeg.installHint}</p> : null}
              </div>
            </div>
          </section>
          {version ? <p className="about muted">Version {version}</p> : null}
        </div>
      </div>
    </div>
  );
}
