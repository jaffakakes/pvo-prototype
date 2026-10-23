import { useCapture } from "../../state/captureStore";
import { setSelectedClipSpeed } from "../../state/editing/clipAdjustmentCommands";
import { dur } from "../../domain/clips/timing";
import { ToolTray } from "../tool-trays/ToolTray";
import styles from "../tool-trays/ToolTray.module.css";

export function SpeedSheet() {
  const state = useCapture();
  const clip = state.clips[state.sel];
  return (
    <ToolTray
      name="Speed"
      readout={
        clip
          ? `${(clip.out - clip.in).toFixed(1)}s → ${dur(clip).toFixed(1)}s`
          : undefined
      }
    >
      <div className={styles.chips}>
        {[0.5, 1, 1.5, 2, 3].map((speed) => (
          <button
            key={speed}
            className={styles.chip}
            aria-pressed={clip?.speed === speed}
            disabled={!clip}
            onClick={() => setSelectedClipSpeed(speed)}
          >
            {speed}×
          </button>
        ))}
      </div>
    </ToolTray>
  );
}
