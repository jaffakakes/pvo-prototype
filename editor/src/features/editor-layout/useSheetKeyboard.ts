import { useEffect, useState, type RefObject } from "react";

function textEntry(element: Element | null): element is HTMLElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !["range", "checkbox", "radio", "button", "submit", "color"].includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/** Visual viewport changes are OS keyboard signals; desktop focus alone does not resize the sheet. */
export function useSheetKeyboard(workspaceRef: RefObject<HTMLDivElement>, enabled: boolean) {
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
        const hasField = textEntry(focused) && !!focused.closest("[data-sheet-body], [data-thread-compose]");
        if (!hasField) viewportBaseline = window.innerHeight;
        const obscured = Math.max(0, viewportBaseline - viewport.height - viewport.offsetTop);
        const next = hasField && obscured > 100 ? obscured : 0;
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

  useEffect(() => {
    if (!keyboardHeight) return;
    const frame = requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (textEntry(focused)) focused.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [keyboardHeight]);

  return keyboardHeight;
}
