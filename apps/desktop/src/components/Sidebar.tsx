import type { ExtractionJobRecord, PreflightReport, Settings } from "@audio-ripper/shared";
import { inView, VIEWS, type ViewId } from "../lib/jobs";
import { ActiveIcon, CheckIcon, DownloadIcon, FailedIcon, FolderIcon, GearIcon, ReviewIcon } from "./Icons";

const VIEW_ICONS: Record<ViewId, typeof DownloadIcon> = {
  all: DownloadIcon,
  active: ActiveIcon,
  review: ReviewIcon,
  finished: CheckIcon,
  failed: FailedIcon
};

interface SidebarProps {
  jobs: ExtractionJobRecord[];
  view: ViewId;
  onViewChange: (view: ViewId) => void;
  settings: Settings | null;
  preflight: PreflightReport | null;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
}

function shortenPath(folder: string): string {
  return folder.replace(/^\/Users\/[^/]+/, "~").replace(/^[A-Z]:\\Users\\[^\\]+/i, "~");
}

export function Sidebar({ jobs, view, onViewChange, settings, preflight, onOpenFolder, onOpenSettings }: SidebarProps) {
  const toolsMissing = preflight?.binaries.filter((item) => !item.available) ?? [];

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <nav className="sidebar-nav" aria-label="Downloads">
        {VIEWS.map(({ id, label }) => {
          const count = jobs.filter((job) => inView(job, id)).length;
          if (id === "failed" && count === 0) {
            return null;
          }
          const Icon = VIEW_ICONS[id];
          return (
            <button
              key={id}
              type="button"
              className={`nav-item${view === id ? " is-current" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => onViewChange(id)}
            >
              <Icon className={`nav-icon tone-${id}`} />
              <span className="nav-label">{label}</span>
              {count > 0 ? <span className={`nav-count${id === "review" ? " is-attention" : ""}`}>{count}</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        {toolsMissing.length > 0 ? (
          <button type="button" className="tool-warning" onClick={onOpenSettings}>
            {toolsMissing.map((item) => item.name).join(" and ")} can't start. Open Settings to fix.
          </button>
        ) : null}
        {settings ? (
          <button type="button" className="foot-link" onClick={onOpenFolder} title={settings.outputRoot}>
            <FolderIcon />
            <span>{shortenPath(settings.outputRoot)}</span>
          </button>
        ) : null}
        <button type="button" className="foot-link" onClick={onOpenSettings}>
          <GearIcon />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
