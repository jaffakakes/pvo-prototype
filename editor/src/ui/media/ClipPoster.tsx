import { useEffect, useRef } from "react";
import type { Clip } from "../../domain/project/model";
import styles from "./ClipPoster.module.css";

/** The media URL belongs to the project; this preview only owns its decoder. */
export function ClipPoster({ clip }: { clip: Pick<Clip, "url" | "in" | "color"> }) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = element.current;
    if (!video || !clip.url) return;
    const seek = () => { video.currentTime = Math.min(clip.in + .05, Math.max(0, video.duration - .01)); };
    video.addEventListener("loadedmetadata", seek);
    video.src = clip.url;
    return () => {
      video.removeEventListener("loadedmetadata", seek);
      video.removeAttribute("src");
      video.load();
    };
  }, [clip.url, clip.in]);
  return <span className={styles.poster} style={{ backgroundColor: clip.color }} aria-hidden="true">
    {clip.url && <video ref={element} muted playsInline preload="metadata" tabIndex={-1} />}
  </span>;
}
