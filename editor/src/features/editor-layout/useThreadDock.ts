import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import {
  threadDockMaximum,
  threadDockMeasurements,
} from "./threadDockGeometry";

type Options = {
  workspaceRef: RefObject<HTMLDivElement>;
  measurements: { height: number; header: number };
  open: boolean;
};

/** Only the thread composer can trigger the conversation's keyboard layout. */
function useThreadKeyboard(
  workspaceRef: RefObject<HTMLDivElement>,
  enabled: boolean,
) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const viewport = window.visualViewport;
    if (!workspace || !viewport || !enabled) {
      setKeyboardHeight(0);
      return;
    }

    let frame = 0;
    let viewportBaseline = window.innerHeight;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        const composing =
          focused instanceof HTMLElement &&
          (focused instanceof HTMLInputElement ||
            focused instanceof HTMLTextAreaElement ||
            focused.isContentEditable) &&
          !!focused.closest("[data-assistant-thread]");
        if (!composing) viewportBaseline = window.innerHeight;
        // Panning toward the focused field does not reduce keyboard occlusion.
        const obscured = Math.max(0, viewportBaseline - viewport.height);
        const next = composing && obscured > 100 ? obscured : 0;
        setKeyboardHeight(next);
      });
    };

    workspace.addEventListener("focusin", update);
    workspace.addEventListener("focusout", update);
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      workspace.removeEventListener("focusin", update);
      workspace.removeEventListener("focusout", update);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [enabled, workspaceRef]);

  return keyboardHeight;
}

/** The open transcript uses 65%; keyboard entry fits just the timeline and composer. */
export function useThreadDock({ workspaceRef, measurements, open }: Options) {
  const keyboardHeight = useThreadKeyboard(workspaceRef, open);
  const [contentHeight, setContentHeight] = useState(0);
  const keyboardOpen = keyboardHeight > 0;
  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!open || !keyboardOpen || !workspace) return;
    const parts = [
      workspace.querySelector<HTMLElement>("[data-assistant-mini-timeline]"),
      workspace.querySelector<HTMLElement>("[data-thread-compose]"),
    ].filter((element): element is HTMLElement => !!element);
    const measure = () => {
      const height = parts.reduce((sum, element) => {
        const style = getComputedStyle(element);
        return (
          sum +
          element.getBoundingClientRect().height +
          (parseFloat(style.marginTop) || 0) +
          (parseFloat(style.marginBottom) || 0)
        );
      }, 0);
      setContentHeight((previous) =>
        Math.abs(previous - height) < 0.5 ? previous : height,
      );
    };
    const observer = new ResizeObserver(measure);
    parts.forEach((element) => observer.observe(element));
    measure();
    return () => observer.disconnect();
  }, [open, keyboardOpen, workspaceRef]);
  const layoutMeasurements = threadDockMeasurements(
    measurements,
    keyboardHeight > 0,
  );
  const maximum = threadDockMaximum(layoutMeasurements, keyboardHeight > 0);
  return {
    height: keyboardOpen
      ? Math.min(layoutMeasurements.height, contentHeight || 188)
      : Math.min(maximum, layoutMeasurements.height * 0.65),
    measurements: layoutMeasurements,
    keyboardHeight,
    compact: layoutMeasurements !== measurements,
  };
}
