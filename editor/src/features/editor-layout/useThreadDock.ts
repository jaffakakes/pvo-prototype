import { useEffect, useState, type RefObject } from "react";
import { usePanelResize } from "./usePanelResize";
import { threadDockDefault, threadDockMaximum, threadDockMeasurements } from "./threadDockGeometry";

type Options = {
  workspaceRef: RefObject<HTMLDivElement>;
  measurements: { height: number; header: number; playback: number };
  open: boolean;
  collapsed: boolean;
  onClose?(): void;
};

/** Only the thread composer can trigger the conversation's keyboard layout. */
function useThreadKeyboard(workspaceRef: RefObject<HTMLDivElement>, enabled: boolean) {
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
        const composing = focused instanceof HTMLElement
          && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused.isContentEditable)
          && !!focused.closest("[data-assistant-thread]");
        if (!composing) viewportBaseline = window.innerHeight;
        const obscured = Math.max(0, viewportBaseline - viewport.height - viewport.offsetTop);
        const next = composing && obscured > 100 ? obscured : 0;
        setKeyboardHeight(next);
        if (next && focused instanceof HTMLElement) {
          focused.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        }
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

/** Keep normal, collapsed, and keyboard sizes independent of one another. */
export function useThreadDock({ workspaceRef, measurements, open, collapsed, onClose }: Options) {
  const keyboardHeight = useThreadKeyboard(workspaceRef, open);
  const layoutMeasurements = threadDockMeasurements(measurements, keyboardHeight > 0);
  const maximum = threadDockMaximum(layoutMeasurements, keyboardHeight > 0);
  const normalMaximum = threadDockMaximum({ ...measurements, height: measurements.height + keyboardHeight });
  const shared = { minimum: 180, dismissBelow: 120, dismiss: onClose };
  const expanded = usePanelResize({ ...shared, maximum: normalMaximum, initial: threadDockDefault(false, false) });
  const compact = usePanelResize({ ...shared, maximum: normalMaximum, initial: threadDockDefault(true, false) });
  const keyboard = usePanelResize({ ...shared, maximum, initial: threadDockDefault(collapsed, true) });
  const resize = keyboardHeight > 0 ? keyboard : collapsed ? compact : expanded;

  return { resize, maximum, measurements: layoutMeasurements, keyboardHeight,
    compact: layoutMeasurements !== measurements };
}
