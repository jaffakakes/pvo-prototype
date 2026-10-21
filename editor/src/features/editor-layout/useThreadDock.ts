import { useEffect, useState, type RefObject } from "react";
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
        const obscured = Math.max(
          0,
          viewportBaseline - viewport.height - viewport.offsetTop,
        );
        const next = composing && obscured > 100 ? obscured : 0;
        setKeyboardHeight(next);
        if (next && focused instanceof HTMLElement) {
          focused.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "instant",
          });
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

/** The transcript fills the lower 65%, while keeping the player usable above the keyboard. */
export function useThreadDock({ workspaceRef, measurements, open }: Options) {
  const keyboardHeight = useThreadKeyboard(workspaceRef, open);
  const layoutMeasurements = threadDockMeasurements(
    measurements,
    keyboardHeight > 0,
  );
  const maximum = threadDockMaximum(layoutMeasurements, keyboardHeight > 0);
  return {
    height: Math.min(maximum, layoutMeasurements.height * 0.65),
    measurements: layoutMeasurements,
    keyboardHeight,
    compact: layoutMeasurements !== measurements,
  };
}
