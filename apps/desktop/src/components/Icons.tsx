import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const DownloadIcon = (p: IconProps) => <Base {...p}><path d="M8 2.5v8M4.8 7.6 8 10.8l3.2-3.2M3 13.5h10" /></Base>;
export const ActiveIcon = (p: IconProps) => <Base {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></Base>;
export const ReviewIcon = (p: IconProps) => <Base {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 5.2v3.3M8 10.7v.1" /></Base>;
export const CheckIcon = (p: IconProps) => <Base {...p}><path d="M3.2 8.5 6.5 11.8 12.8 4.5" /></Base>;
export const FailedIcon = (p: IconProps) => <Base {...p}><circle cx="8" cy="8" r="5.5" /><path d="m6 6 4 4M10 6l-4 4" /></Base>;
export const LinkIcon = (p: IconProps) => <Base {...p}><path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" /></Base>;
export const FolderIcon = (p: IconProps) => <Base {...p}><path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /></Base>;
export const GearIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
  </Base>
);
export const MusicIcon = (p: IconProps) => <Base {...p}><path d="M6 12V3.6l7-1.4v8.4" /><circle cx="4.4" cy="12" r="1.7" /><circle cx="11.4" cy="10.6" r="1.7" /></Base>;
export const VideoIcon = (p: IconProps) => <Base {...p}><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m7 6.2 2.8 1.8L7 9.8z" /></Base>;
export const CopyIcon = (p: IconProps) => <Base {...p}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></Base>;
export const ChevronIcon = (p: IconProps) => <Base {...p}><path d="m6 4 4 4-4 4" /></Base>;
export const ImageIcon = (p: IconProps) => <Base {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><circle cx="6" cy="6" r="1.2" /><path d="m3 12 3.5-3.5 2.5 2.5 1.5-1.5 2.5 2.5" /></Base>;
export const ScissorsIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="4.5" cy="4.5" r="2" />
    <circle cx="4.5" cy="11.5" r="2" />
    <path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4" />
  </Base>
);
export const PlayIcon = (p: IconProps) => <Base {...p}><path d="M5 3.5v9l7.5-4.5z" fill="currentColor" /></Base>;
export const PauseIcon = (p: IconProps) => <Base {...p}><path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2.2} /></Base>;
