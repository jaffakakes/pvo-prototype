import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { fmt, pickTime } from "../../ui/formatTime";
import { togglePlayback } from "../../state/editing/playbackCommands";
import { startTry } from "./tryMode";
import { DebugEntry } from "../editor-layout/debugging/DebugEntry";
import styles from "./Transport.module.css";

export function Transport({
  threadOpen = false,
}: { threadOpen?: boolean } = {}) {
  const s = useCapture();
  const duration = sceneDuration(s);
  const componentPickerOpen = s.sheet === "components";
  return (
    <div
      className={`${cx("transport")} ${styles.transport}`}
      data-thread-open={threadOpen}
      role="toolbar"
      aria-label="Playback controls"
    >
      <div className={`${cx("transportTime")} ${styles.time}`}>
        {s.playheadPick ? pickTime(s.t) : fmt(s.t)}{" "}
        <span>/ {fmt(duration)}</span>
      </div>
      <button
        type="button"
        className={`${cx("playBtn")} ${styles.play}`}
        onClick={togglePlayback}
        aria-label={s.playing ? "Pause" : "Play"}
        disabled={!!s.tryMode?.holdingId}
      >
        <Icon name={s.playing ? "pause" : "play"} size={28} />
      </button>
      <div className={styles.actions}>
        {s.tryMode ? (
          <DebugEntry variant="mobile" />
        ) : (
          <>
            <button
              type="button"
              className={styles.action}
              onClick={() => useCapture.getState().undo()}
              disabled={!s.past.length}
              aria-label="Undo"
            >
              <Icon name="undo" size={23} />
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => useCapture.getState().redo()}
              disabled={!s.future.length}
              aria-label="Redo"
            >
              <Icon name="redo" size={23} />
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.tryButton}`}
              onClick={
                componentPickerOpen ? () => s.patch({ sheet: null }) : startTry
              }
              disabled={!componentPickerOpen && duration <= 0}
              aria-label={componentPickerOpen ? "Close components" : "Try"}
              title={
                componentPickerOpen
                  ? "Close components"
                  : "Try interactive preview"
              }
            >
              <Icon name={componentPickerOpen ? "close" : "eye"} size={23} />
            </button>
          </>
        )}
      </div>
      {threadOpen && (
        <span className={styles.threadStatus}>Paused · Restyle open</span>
      )}
    </div>
  );
}
