import { useEffect, useRef } from "react";
import { installComponentFrameTouchGestures } from "./componentFrameTouchGestures";
import { installTouchGesturePolicy } from "./installTouchGesturePolicy";

/** Keep touch pinches available to editor tools without magnifying the page. */
export function useAppTouchGestures() {
  const appRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;

    const removeAppPolicy = installTouchGesturePolicy(app);
    const removeFramePolicies = installComponentFrameTouchGestures(app);

    return () => {
      removeFramePolicies();
      removeAppPolicy();
    };
  }, []);

  return appRef;
}
