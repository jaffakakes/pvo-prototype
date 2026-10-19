import { sceneDuration } from "../../domain/scenes/duration";
import { togglePlayback } from "../../state/editing/playbackCommands";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { fmt, pickTime } from "../../ui/formatTime";
import styles from "./PlayerPlayback.module.css";

/** Player chrome stays separate from authored media and overlay gestures. */
export function PlayerPlayback({
  topZ,
  insetControls,
  compact,
}: {
  topZ: number;
  insetControls: boolean;
  compact: boolean;
}) {
  const playing = useCapture((state) => state.playing);
  const time = useCapture((state) => state.t);
  const picking = useCapture((state) => !!state.playheadPick);
  const holding = useCapture((state) => !!state.tryMode?.holdingId);
  const duration = useCapture(sceneDuration);
  return (
    <div className={styles.overlay} data-player-playback data-compact={compact}>
      <button
        type="button"
        className={`${cx("playBtn")} ${styles.play}`}
        style={{ zIndex: topZ }}
        onClick={togglePlayback}
        aria-label={playing ? "Pause" : "Play"}
        disabled={holding || picking || duration <= 0}
      >
        <Icon name={playing ? "pause" : "play"} size={32} />
      </button>
      <div
        className={`${cx("transportTime")} ${styles.time}`}
        data-inset-controls={insetControls}
        style={{ zIndex: topZ }}
        aria-label={`Playback time ${pickTime(time)} of ${pickTime(duration)}`}
      >
        {picking ? pickTime(time) : fmt(time)} <span>/ {fmt(duration)}</span>
      </div>
    </div>
  );
}
