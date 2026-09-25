import type { SVGProps } from "react";

const paths: Record<string, React.ReactNode> = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 18l-6-6 6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  down: <path d="M6 9l6 6 6-6" />,
  camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  music: <><path d="M9 18V6l12-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  flip: <><path d="M20 12a8 8 0 0 1-14.9 4M4 12a8 8 0 0 1 14.9-4M4 20v-4h4M20 4v4h-4" /></>,
  flash: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M10 2h4" /></>,
  speed: <><circle cx="12" cy="12" r="9" /><path d="M12 12V7M12 12l3.5 2" /></>,
  filters: <><circle cx="9" cy="10" r="5" /><circle cx="15" cy="10" r="5" /><circle cx="12" cy="15" r="5" /></>,
  upload: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8.5" cy="9.5" r="1.8" /><path d="m21 15-4.5-4.5L7 20" /></>,
  undoTake: <><path d="M21 6H9L3 12l6 6h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zM18 9l-6 6M12 9l6 6" /></>,
  sparkle: <path d="M12 2l2.4 5.6L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-1.4z" fill="currentColor" stroke="none" />,
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  pause: <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" stroke="none" />,
  undo: <><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  redo: <><path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></>,
  fullscreen: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  speaker: <><path d="m11 5-5 4H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  muted: <><path d="m11 5-5 4H2v6h4l5 4z" /><path d="m16 9 6 6M22 9l-6 6" stroke="#FF5C5C" /></>,
  edit: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M8 6v12M16 6v12" /></>,
  text: <path d="M4 7V5h16v2M9 20h6M12 5v15" />,
  ratio: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 7h2M9 7v2M15 17h-2M15 17v-2" /></>,
  split: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.5 15.5M14.5 9.5 20 15" /></>,
  replace: <path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />,
  delete: <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />,
  crop: <path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />,
  mirror: <path d="M12 3v18M8 7 3 12l5 5M16 7l5 5-5 5" />,
  check: <path d="m5 12 5 5 9-11" />,
  export: <path d="M12 15V3m0 0L8 7m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
};

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
