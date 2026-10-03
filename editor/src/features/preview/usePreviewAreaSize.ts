import { useLayoutEffect, useRef, useState } from "react";
import { whenLaunchSplashDismissed } from "../launch-splash/launchSplash";

export function usePreviewAreaSize() {
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const host = areaRef.current;
    if (!host) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const style = getComputedStyle(host);
      const width = Math.max(0, host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      const height = Math.max(0, host.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
      setArea(previous => previous.width === width && previous.height === height
        ? previous : { width, height });
    };
    const visible = () => {
      if (document.visibilityState === "visible") measure();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    // A covered or background page may miss its first observer notification.
    // Measure independently of paint, then again when the editor is revealed.
    measure();
    void whenLaunchSplashDismissed().then(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("pageshow", measure);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("pageshow", measure);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  return { areaRef, area };
}
