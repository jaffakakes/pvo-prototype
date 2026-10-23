import { useState } from "react";
import { useCapture } from "../../state/captureStore";
import {
  assistantFocused,
  useAssistant,
} from "../../state/assistant/assistantStore";
import {
  selectedTimelineAnimation,
  setTimelineEasing,
} from "../../state/animation/timelineControls";
import { ToolTray } from "../tool-trays/ToolTray";
import { EasingChips } from "./EasingChips";
import styles from "./EasingTray.module.css";

export function EasingTray() {
  const state = useCapture();
  const busy = useAssistant(assistantFocused);
  const model = selectedTimelineAnimation(state);
  const [error, setError] = useState<string | null>(null);
  const segment = model?.segment;
  const disabled = busy || !model || model.disabled || !segment?.next;
  return (
    <ToolTray name="Graphs" caption={false}>
      <div className={styles.curves}>
        <p role="status">
          {error ??
            (!model
              ? "Select a layer to choose a curve."
              : model.keys.length < 2
                ? "Add two keyframes to choose a curve."
                : !segment?.next
                  ? "Choose an earlier keyframe to change its curve."
                  : "To next keyframe")}
        </p>
        <EasingChips
          value={segment?.next ? segment.key.easing : null}
          disabled={disabled}
          compact
          onChange={(easing) => {
            try {
              setError(null);
              setTimelineEasing(easing);
            } catch {
              setError("Couldn’t change the curve. Try again.");
            }
          }}
        />
      </div>
    </ToolTray>
  );
}
