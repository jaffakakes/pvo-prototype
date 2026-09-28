import { useCapture } from "../../../state/captureStore";
import { fmt } from "../../../ui/formatTime";
import {
  acceptPlayheadPick,
  cancelPlayheadPick,
} from "../../timeline/playheadPick";
import styles from "./TimelineTimePicker.module.css";

/** Existing timing commands stay reachable while the desktop Inspector is inert. */
export function TimelineTimePicker() {
  const pick = useCapture((state) => state.playheadPick);
  const time = useCapture((state) => state.t);
  if (!pick) return null;
  return (
    <div
      className={styles.picker}
      role="group"
      aria-label="Choose playhead time"
    >
      <div className={styles.copy}>
        <strong>
          {pick.kind === "outcome-time" ? "Jump to when?" : "Appears when?"}
        </strong>
        {pick.error ? (
          <span className={styles.error} role="alert">
            {pick.error}
          </span>
        ) : (
          <span>Scrub the timeline, then use this time.</span>
        )}
      </div>
      <span className={styles.time}>{time.toFixed(1)}s</span>
      <button type="button" autoFocus onClick={cancelPlayheadPick}>
        Cancel
      </button>
      <button
        type="button"
        className={styles.accept}
        onClick={acceptPlayheadPick}
      >
        Use {fmt(time)}
      </button>
    </div>
  );
}
