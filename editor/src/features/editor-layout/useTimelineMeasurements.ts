import { useLayoutEffect, useState, type RefObject } from "react";

type ContentMeasurements = {
  tracks: number;
  tools: number;
  scenes: number;
  handle: number;
};

const MINIMUM_TRACK_HEIGHT = 88;
const DEFAULT_HANDLE_HEIGHT = 24;

/** Measure natural content, never the panel height allocated by the resize control. */
export function useTimelineMeasurements(contentRef: RefObject<HTMLDivElement>, workspaceHeight: number) {
  const [content, setContent] = useState<ContentMeasurements>({
    tracks: 134,
    tools: 68,
    scenes: 0,
    handle: DEFAULT_HANDLE_HEIGHT,
  });

  useLayoutEffect(() => {
    const panel = contentRef.current;
    if (!panel) return;

    const measure = () => {
      const timeline = panel.querySelector<HTMLElement>(".tl");
      const tracks = timeline?.querySelector<HTMLElement>(":scope > .timelineContent");
      const tools = panel.querySelector<HTMLElement>(".toolBar");
      const scenes = panel.querySelector<HTMLElement>(".scenesRow");
      const handle = panel.previousElementSibling;
      const timelineStyle = timeline ? getComputedStyle(timeline) : null;
      const border = timelineStyle
        ? (parseFloat(timelineStyle.borderTopWidth) || 0) + (parseFloat(timelineStyle.borderBottomWidth) || 0)
        : 0;
      const next = {
        tracks: (tracks?.getBoundingClientRect().height ?? 0) + border,
        tools: tools?.getBoundingClientRect().height ?? 0,
        scenes: scenes?.getBoundingClientRect().height ?? 0,
        handle: handle?.getBoundingClientRect().height ?? DEFAULT_HANDLE_HEIGHT,
      };
      setContent(previous => previous.tracks === next.tracks && previous.tools === next.tools
        && previous.scenes === next.scenes && previous.handle === next.handle ? previous : next);
    };

    const observer = new ResizeObserver(measure);
    const observeContent = () => {
      observer.disconnect();
      // These nodes retain their intrinsic height when the panel grows or shrinks.
      for (const element of panel.querySelectorAll(".tl > .timelineContent, .toolBar, .scenesRow")) {
        observer.observe(element);
      }
      if (panel.previousElementSibling) observer.observe(panel.previousElementSibling);
      measure();
    };
    const children = new MutationObserver(observeContent);
    children.observe(panel, { childList: true, subtree: true });
    observeContent();

    return () => {
      children.disconnect();
      observer.disconnect();
    };
  }, [contentRef]);

  const chrome = content.handle + content.scenes + content.tools;
  const minimumTracks = Math.min(MINIMUM_TRACK_HEIGHT, content.tracks);
  const preferredTracks = Math.min(content.tracks, Math.max(0, workspaceHeight) * 0.3);
  return {
    naturalHeight: chrome + Math.max(minimumTracks, preferredTracks),
    minimum: chrome + minimumTracks,
  };
}
