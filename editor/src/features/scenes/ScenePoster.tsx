import type { Scene } from "../../domain/project/model";
import styles from "./ScenesPanel.module.css";

export function ScenePoster({ scene }: { scene: Scene }) {
  const clip = scene.clips[0];
  return (
    <span
      className={styles.poster}
      data-empty={!clip}
      aria-hidden="true"
      style={{ backgroundColor: clip?.color }}
    >
      {clip?.url && (
        <video
          src={`${clip.url}#t=${clip.in}`}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = clip.in;
          }}
          style={{
            objectFit: clip.fit,
            transform: `scale(${clip.mirror ? -clip.zoom : clip.zoom}, ${clip.zoom})`,
          }}
        />
      )}
    </span>
  );
}
