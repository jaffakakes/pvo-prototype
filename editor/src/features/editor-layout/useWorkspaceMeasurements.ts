import { useLayoutEffect, useRef, useState } from "react";

/** Measures available viewport space and the natural navigation height. */
export function useWorkspaceMeasurements(followThreadKeyboard = false) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [measurements, setMeasurements] = useState({
    height: 0,
    width: 390,
    header: 0,
    controls: 0,
    toolbar: 0,
  });

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const header = headerRef.current;
    const controls = controlsRef.current;
    if (!workspace || !header) return;

    const measure = () => {
      const style = getComputedStyle(workspace);
      const verticalInset =
        (parseFloat(style.paddingTop) || 0) +
        (parseFloat(style.paddingBottom) || 0);
      const next = {
        height: Math.max(0, workspace.clientHeight - verticalInset),
        width: workspace.clientWidth,
        // Assistant focus transforms presentation, not the grid measurements.
        header: header.offsetHeight,
        controls: controls?.scrollHeight ?? 0,
      };
      setMeasurements((previous) => {
        const toolbar = controls
          ?.querySelector(".toolBar")
          ?.getBoundingClientRect().height;
        const nextToolbar = toolbar || previous.toolbar;
        return previous.height === next.height &&
          previous.width === next.width &&
          previous.header === next.header &&
          previous.controls === next.controls &&
          previous.toolbar === nextToolbar
          ? previous
          : { ...next, toolbar: nextToolbar };
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    observer.observe(header);
    if (controls) observer.observe(controls);
    measure();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const viewport = window.visualViewport;
    if (!workspace || !viewport) return;
    // Mobile keyboards can resize the visual viewport without changing 100dvh.
    const fitViewport = () => {
      // A fixed keyboard workspace follows layout-viewport coordinates directly.
      // Safari's client rects can already include its keyboard pan; feeding those
      // moving rects back into top would apply that pan a second time.
      workspace.style.setProperty(
        "--visual-viewport-top",
        `${viewport.offsetTop}px`,
      );
      workspace.style.setProperty(
        "--visual-viewport-height",
        `${viewport.height}px`,
      );
      const available = followThreadKeyboard
        ? viewport.height
        : viewport.height +
          viewport.offsetTop -
          workspace.getBoundingClientRect().top;
      workspace.style.maxHeight = `${Math.max(0, available)}px`;
    };
    fitViewport();
    viewport.addEventListener("resize", fitViewport);
    viewport.addEventListener("scroll", fitViewport);
    window.addEventListener("resize", fitViewport);
    workspace.addEventListener("focusin", fitViewport);
    workspace.addEventListener("focusout", fitViewport);
    return () => {
      viewport.removeEventListener("resize", fitViewport);
      viewport.removeEventListener("scroll", fitViewport);
      window.removeEventListener("resize", fitViewport);
      workspace.removeEventListener("focusin", fitViewport);
      workspace.removeEventListener("focusout", fitViewport);
      workspace.style.removeProperty("max-height");
      workspace.style.removeProperty("--visual-viewport-top");
      workspace.style.removeProperty("--visual-viewport-height");
    };
  }, [followThreadKeyboard]);

  return { workspaceRef, headerRef, controlsRef, ...measurements };
}
