import { useCapture } from "../../state/captureStore";
import {
  assistantFocused,
  useAssistant,
} from "../../state/assistant/assistantStore";
import { canAuthorAnimation } from "../../state/animation/access";
import {
  selectedTimelineAnimation,
  selectTimelineKeyframe,
} from "../../state/animation/timelineControls";
import { formatKeyTime } from "./presentation";
import styles from "./TimelineAnimationPoints.module.css";

/** Real buttons sit beside the clip button, keeping key selection separate from trimming. */
export function TimelineAnimationPoints({ clipId }: { clipId: number }) {
  const state = useCapture();
  const busy = useAssistant(assistantFocused);
  const model = selectedTimelineAnimation(state);
  if (
    !model ||
    model.target.kind !== "clip" ||
    model.target.id !== clipId ||
    !model.keys.length
  )
    return null;
  const stride = Math.max(1, Math.ceil(model.keys.length / 48));
  return (
    <div className={styles.points} role="group" aria-label="Video keyframes">
      {model.keys
        .filter(
          (_, index) => index % stride === 0 || index === model.keys.length - 1,
        )
        .map((key) => (
          <button
            type="button"
            key={key.time}
            className={styles.point}
            data-keyframe-point
            aria-label={`Keyframe at ${formatKeyTime(key.time - model.layer.start)}`}
            aria-pressed={Math.abs(state.t - key.time) < 0.001}
            disabled={busy || !canAuthorAnimation(state)}
            style={{
              left: `${((key.time - model.layer.start) / (model.layer.end - model.layer.start)) * 100}%`,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              selectTimelineKeyframe(key.time);
            }}
          >
            <i aria-hidden="true" />
          </button>
        ))}
    </div>
  );
}
