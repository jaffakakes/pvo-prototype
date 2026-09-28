import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SheetDockContextValue } from "../../../ui/sheets/SheetDockContext";

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';

/** Expands the same mounted authoring panel, retaining the code editor's draft and selection. */
export function useInspectorExpansion(componentId: string | undefined, advanced: boolean, assistantActive = false) {
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const previousComponent = useRef(componentId);
  const wasExpanded = useRef(false);
  const [expanded, setExpandedState] = useState(false);
  const setExpanded = useCallback((next: boolean) => {
    if (!next && assistantActive) return;
    if (next && !expanded) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setExpandedState(next);
  }, [expanded, assistantActive]);

  useEffect(() => {
    if (componentId !== previousComponent.current || !advanced) setExpandedState(false);
    previousComponent.current = componentId;
  }, [componentId, advanced]);

  useLayoutEffect(() => {
    if (expanded) panel.current?.querySelector<HTMLTextAreaElement>("[data-pvo-source-editor] textarea")?.focus({ preventScroll: true });
    else if (wasExpanded.current && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    wasExpanded.current = expanded;
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const controls = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter(item => item.getClientRects().length > 0 && !item.closest('[inert], [hidden], [aria-hidden="true"]')
        && item.getAttribute("aria-disabled") !== "true" && getComputedStyle(item).visibility !== "hidden");
    const keydown = (event: KeyboardEvent) => {
      // The assistant owns Escape and its own Tab cycle, including notifications.
      if (assistantActive) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (assistantActive && event.target instanceof Element && event.target.closest("[data-notification-root]")) return;
      if (event.target instanceof Node && !panel.current?.contains(event.target)) {
        controls()[0]?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
    };
  }, [expanded, setExpanded, assistantActive]);

  const dock = useMemo<SheetDockContextValue>(() => ({
    expanded,
    setExpanded,
    registerDismiss: () => () => undefined,
  }), [expanded, setExpanded]);
  return { panel, expanded, setExpanded, dock };
}
