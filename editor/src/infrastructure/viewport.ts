import { useSyncExternalStore } from "react";

export const WIDE_LAYOUT_QUERY = "(min-width: 1024px) and (orientation: landscape)";
const viewport = window.matchMedia(WIDE_LAYOUT_QUERY);
const subscribe = (listener: () => void) => {
  viewport.addEventListener("change", listener);
  return () => viewport.removeEventListener("change", listener);
};

export const isWideLayout = () => viewport.matches;
export const useWideLayout = () => useSyncExternalStore(subscribe, isWideLayout);
