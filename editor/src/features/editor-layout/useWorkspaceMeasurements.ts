import { useLayoutEffect, useRef, useState } from "react";

/** Measures available viewport space and the natural navigation/playback heights. */
export function useWorkspaceMeasurements() {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef<HTMLDivElement>(null);
  const [measurements, setMeasurements] = useState({ height: 0, width: 390, header: 56, playback: 52 });

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const header = headerRef.current;
    const playback = playbackRef.current;
    if (!workspace || !header || !playback) return;

    const measure = () => {
      const style = getComputedStyle(workspace);
      const verticalInset = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const next = {
        height: Math.max(0, workspace.clientHeight - verticalInset),
        width: workspace.clientWidth,
        header: header.getBoundingClientRect().height,
        playback: playback.getBoundingClientRect().height,
      };
      setMeasurements(previous => previous.height === next.height && previous.width === next.width && previous.header === next.header
        && previous.playback === next.playback ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    observer.observe(header);
    observer.observe(playback);
    measure();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const viewport = window.visualViewport;
    if (!workspace || !viewport) return;
    // Mobile keyboards can resize the visual viewport without changing 100dvh.
    const fitViewport = () => {
      const available = viewport.height + viewport.offsetTop - workspace.getBoundingClientRect().top;
      workspace.style.maxHeight = `${Math.max(0, available)}px`;
    };
    fitViewport();
    viewport.addEventListener("resize", fitViewport);
    viewport.addEventListener("scroll", fitViewport);
    window.addEventListener("resize", fitViewport);
    return () => {
      viewport.removeEventListener("resize", fitViewport);
      viewport.removeEventListener("scroll", fitViewport);
      window.removeEventListener("resize", fitViewport);
      workspace.style.removeProperty("max-height");
    };
  }, []);

  return { workspaceRef, headerRef, playbackRef, ...measurements };
}
