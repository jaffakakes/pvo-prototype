import { useState } from "react";
import { useCapture } from "../../state/captureStore";
import { sameAnimationTarget } from "../../state/animation/access";
import { useAnimationSelection } from "../../state/animation/selection";
import { KEYFRAME_TIME_EPSILON } from "../../domain/animation/editing";
import {
  assistantFocused,
  useAssistant,
} from "../../state/assistant/assistantStore";
import {
  selectedTimelineAnimation,
  toggleTimelineGraphs,
  toggleTimelineKeyframe,
} from "../../state/animation/timelineControls";
import styles from "./TimelineAnimationControls.module.css";

export function TimelineAnimationControls() {
  const state = useCapture();
  const busy = useAssistant(assistantFocused);
  const model = selectedTimelineAnimation(state);
  const selection = useAnimationSelection((value) => value.selection);
  const [error, setError] = useState<string | null>(null);
  if (!model) return null;
  const keySelected =
    !!selection &&
    !!model.here &&
    selection.sceneId === state.currentSceneId &&
    sameAnimationTarget(selection.target, model.target) &&
    Math.abs(selection.time - state.t) < KEYFRAME_TIME_EPSILON;
  const disabled = busy || !model || model.disabled;
  const graphs =
    state.sheet === "keyframes" || state.sheet === "volumeKeyframes";
  const perform = (operation: () => unknown) => {
    try {
      setError(null);
      operation();
    } catch {
      setError("Couldn’t update the keyframe. Try again.");
    }
  };
  return (
    <div
      className={styles.controls}
      data-timeline-animation-controls
      role="toolbar"
      aria-label="Keyframe controls"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={model?.here ? "Remove keyframe" : "Add keyframe"}
        aria-pressed={!!model?.here}
        title={
          model?.here
            ? "Remove keyframe at the playhead"
            : "Add keyframe at the playhead"
        }
        onClick={() => perform(toggleTimelineKeyframe)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path
            d="m12 3 9 9-9 9-9-9Z"
            fill={model?.here ? "currentColor" : "none"}
          />
          {!model?.here && <path d="M12 8v8M8 12h8" strokeLinecap="round" />}
        </svg>
      </button>
      {keySelected && (
        <button
          type="button"
          disabled={disabled}
          aria-label="Graphs"
          aria-expanded={graphs}
          aria-pressed={graphs}
          title="Motion to the next keyframe"
          onClick={() => perform(toggleTimelineGraphs)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 3v17h17M7 16C14 16 10 6 20 5" />
            <circle cx="7" cy="16" r="1.4" />
            <circle cx="20" cy="5" r="1.4" />
          </svg>
        </button>
      )}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
