import type { ReactNode } from "react";

type IconName = "activity" | "timeline" | "play" | "pause" | "stop" | "check" | "close" | "warn" | "block" | "clock" | "ignored" | "minus" | "sparkle" | "code" | "back" | "chevron" | "down" | "copy" | "locate" | "pin" | "more" | "request";

const paths: Record<IconName, ReactNode> = {
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  timeline: <path d="M4 6h9M4 12h16M4 18h12" />,
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />,
  stop: <path d="M6 6h12v12H6z" />,
  check: <path d="m5 12 5 5 9-11" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  warn: <path d="M12 3.5 2.5 20h19zM12 10v4.5M12 17.2v.3" />,
  block: <><circle cx="12" cy="12" r="9" /><path d="M7.5 12h9" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  ignored: <><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></>,
  minus: <path d="M6 12h12" />,
  sparkle: <path d="M12 2l2.4 5.6L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-1.4z" />,
  code: <path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5" />,
  back: <path d="m15 18-6-6 6-6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  copy: <path d="M10.5 8h7a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 8 17.5v-7A2.5 2.5 0 0 1 10.5 8zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />,
  locate: <><circle cx="12" cy="12" r="6" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  pin: <path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8" />,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  request: <path d="M4 12h16m-5-5 5 5-5 5" />,
};

export function DebugIcon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
