import { dur } from "../../../domain/clips/timing";
import { sceneDuration } from "../../../domain/scenes/duration";
import { useCapture } from "../../../state/captureStore";
import type { AssistantExchange } from "../../../domain/assistant/thread";
import styles from "./AssistantChangeStrip.module.css";

export function AssistantChangeStrip({
  items,
  onShow,
  canShow,
}: {
  items: readonly AssistantExchange[];
  onShow(id: string): void;
  canShow(item: AssistantExchange): boolean;
}) {
  const clips = useCapture((state) => state.clips);
  const sceneId = useCapture((state) => state.currentSceneId);
  const time = useCapture((state) => state.t);
  const duration = useCapture(sceneDuration);
  const position = (at: number) =>
    `${Math.min(100, Math.max(0, (at / (duration || 1)) * 100))}%`;
  return (
    <div
      className={styles.strip}
      aria-label="Changes in this scene"
      data-assistant-change-strip
    >
      <div className={styles.clips} aria-hidden="true">
        {clips.map((clip) => (
          <span
            key={clip.id}
            style={{ width: position(dur(clip)), background: clip.color }}
          />
        ))}
      </div>
      <span
        className={styles.playhead}
        style={{ left: position(time) }}
        aria-hidden="true"
      />
      {items
        .filter((item) => item.sceneId === sceneId)
        .map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.dot}
            style={{ left: position(item.at) }}
            data-pending={item.status === "pending"}
            aria-label={`Show change: ${item.request}`}
            disabled={!canShow(item)}
            onClick={() => onShow(item.id)}
          />
        ))}
    </div>
  );
}
