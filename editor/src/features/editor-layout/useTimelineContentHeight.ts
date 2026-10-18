import { useLayoutEffect, useState, type RefObject } from "react";

/** Read natural track content, rather than the stretched timeline viewport. */
export function useTimelineContentHeight(ref: RefObject<HTMLDivElement>) {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const tracks = root.querySelector<HTMLElement>(".tl > .timelineContent");
      const timeline = root.querySelector<HTMLElement>(".tl");
      const toolbar = root.querySelector<HTMLElement>(".toolBar");
      const scenes = root.querySelector<HTMLElement>(".scenesRow");
      if (!tracks || !timeline || !toolbar) return;
      const style = getComputedStyle(timeline);
      const borders =
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const next =
        tracks.getBoundingClientRect().height +
        borders +
        toolbar.getBoundingClientRect().height +
        (scenes?.getBoundingClientRect().height ?? 0);
      setHeight((previous) => (previous === next ? previous : next));
    };
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect();
      root
        .querySelectorAll(".tl > .timelineContent, .toolBar, .scenesRow")
        .forEach((element) => resize.observe(element));
      measure();
    };
    const children = new MutationObserver(observe);
    children.observe(root, { childList: true, subtree: true });
    observe();
    return () => {
      resize.disconnect();
      children.disconnect();
    };
  }, [ref]);
  return height;
}
