import { useEffect, useRef, useState } from "react";
import { sceneDuration } from "../../domain/scenes/duration";
import { togglePlayback } from "../../state/editing/playbackCommands";
import { componentLayerTool } from "../../state/components/componentLayerCommands";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { fmt, pickTime } from "../../ui/formatTime";
import styles from "./PlayerPlayback.module.css";

/** Player chrome stays separate from authored media and overlay gestures. */
export function PlayerPlayback({
  topZ,
  videoZ,
  compact,
}: {
  topZ: number;
  videoZ: number;
  compact: boolean;
}) {
  const playing = useCapture((state) => state.playing);
  const time = useCapture((state) => state.t);
  const picking = useCapture((state) => !!state.playheadPick);
  const holding = useCapture((state) => !!state.tryMode?.holdingId);
  const duration = useCapture(sceneDuration);
  const hasPlayed = useRef(playing);
  const [feedbackVisible, setFeedbackVisible] = useState(true);
  useEffect(() => {
    if (playing) hasPlayed.current = true;
    setFeedbackVisible(true);
    if (!hasPlayed.current) return;
    const timeout = window.setTimeout(() => setFeedbackVisible(false), 800);
    return () => window.clearTimeout(timeout);
  }, [playing]);
  return (
    <div className={styles.overlay} data-player-playback data-compact={compact}>
      <button
        type="button"
        className={`${cx("playBtn")} ${styles.play}`}
        style={{ zIndex: videoZ }}
        onClick={() => {
          const state = useCapture.getState();
          if (state.selComp && !state.tryMode)
            state.patch({
              selComp: null,
              ...(componentLayerTool(state.sheet) ? { sheet: null } : {}),
            });
          else togglePlayback();
        }}
        aria-label={playing ? "Pause" : "Play"}
        disabled={holding || picking || duration <= 0}
      >
        <span
          className={styles.glyph}
          data-playback-feedback
          data-visible={feedbackVisible}
          aria-hidden="true"
        >
          <Icon name={playing ? "pause" : "play"} size={32} />
        </span>
      </button>
      <div
        className={`${cx("transportTime")} ${styles.time}`}
        style={{ zIndex: topZ }}
        aria-label={`Playback time ${pickTime(time)} of ${pickTime(duration)}`}
      >
        {picking ? pickTime(time) : fmt(time)} <span>/ {fmt(duration)}</span>
      </div>
    </div>
  );
}
