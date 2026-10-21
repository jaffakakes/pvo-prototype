import { useLayoutEffect, useState, type RefObject } from "react";
import type { AssistantPlacement } from "./OrbAssistantView";

/** Measure the existing host; assistant placement never changes workspace geometry. */
export function useAssistantPlacement(
  ref: RefObject<HTMLDivElement>,
  position: AssistantPlacement = "workspace",
  portalTarget?: HTMLElement | null,
) {
  const [placement, setPlacement] = useState({
    top: 0,
    toolbarHeight: 100,
    availableHeight: 500,
  });
  useLayoutEffect(() => {
    const host = ref.current;
    if (position === "floating" && host) {
      const measure = () => {
        const availableHeight = host.getBoundingClientRect().height;
        setPlacement((previous) =>
          previous.availableHeight === availableHeight &&
          previous.toolbarHeight === 100
            ? previous
            : { top: 0, toolbarHeight: 100, availableHeight },
        );
      };
      const observer = new ResizeObserver(measure);
      observer.observe(host);
      measure();
      return () => observer.disconnect();
    }
    if (position === "toolbar" && host) {
      const measure = () => {
        const bounds = host.getBoundingClientRect();
        const availableHeight = Math.max(
          160,
          Math.min(520, bounds.bottom - 16),
        );
        setPlacement((previous) =>
          previous.availableHeight === availableHeight &&
          previous.toolbarHeight === 46
            ? previous
            : { top: 0, toolbarHeight: 46, availableHeight },
        );
      };
      const observer = new ResizeObserver(measure);
      const editor = host.closest("[data-desktop-editor]");
      if (editor) observer.observe(editor);
      observer.observe(host);
      window.addEventListener("resize", measure);
      measure();
      return () => {
        observer.disconnect();
        window.removeEventListener("resize", measure);
      };
    }
    const workspace = host?.closest(".editorWorkspace");
    const transport = workspace?.querySelector<HTMLElement>(
      "[data-assistant-playback]",
    );
    let toolbar = workspace?.querySelector<HTMLElement>(".toolBar");
    if (!workspace || !toolbar || !transport) return;
    const measure = () => {
      // The toolbar is pinned to the dock bottom. Its parent can translate while
      // entering or recede during assistant focus; measure its layout size.
      const toolbarHeight = toolbar?.offsetHeight;
      if (toolbarHeight === undefined) return;
      setPlacement((previous) =>
        previous.toolbarHeight === toolbarHeight
          ? previous
          : { ...previous, top: 0, toolbarHeight },
      );
    };
    const observer = new ResizeObserver(measure);
    // Track the grid rows as they animate: transport can move without resizing.
    [
      workspace,
      toolbar,
      transport,
      ...Array.from(workspace.children).filter((element) => element !== host),
    ].forEach((element) => observer.observe(element));
    // Ratio and voiceover replace the toolbar node; follow the current one.
    const toolbarChanges = new MutationObserver(() => {
      const current = workspace.querySelector<HTMLElement>(".toolBar");
      if (current === toolbar) return;
      if (toolbar) observer.unobserve(toolbar);
      toolbar = current;
      if (toolbar) observer.observe(toolbar);
      measure();
    });
    toolbarChanges.observe(workspace, { childList: true, subtree: true });
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => {
      toolbarChanges.disconnect();
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [ref, position, portalTarget]);
  return placement;
}
