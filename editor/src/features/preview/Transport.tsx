import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { startTry } from "./tryMode";
import { DebugEntry } from "../editor-layout/debugging/DebugEntry";
import styles from "./Transport.module.css";
import { useSheetDock } from "../../ui/sheets/SheetDockContext";

export function Transport({
  threadOpen = false,
  overVideo = false,
}: { threadOpen?: boolean; overVideo?: boolean } = {}) {
  const s = useCapture();
  const duration = sceneDuration(s);
  const dock = useSheetDock();
  const sheetOpen = s.sheet !== null && s.sheet !== "export" && !s.playheadPick;
  return (
    <div
      className={`${cx("transport")} ${styles.transport}`}
      data-thread-open={threadOpen}
      data-over-video={overVideo}
      data-assistant-playback
      role="toolbar"
      aria-label="Playback controls"
    >
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
              onClick={sheetOpen ? dock?.dismissFromTransport : startTry}
              disabled={sheetOpen ? dock?.dismissDisabled : duration <= 0}
              aria-label={sheetOpen ? "Close sheet" : "Try"}
              title={sheetOpen ? "Close sheet" : "Try interactive preview"}
            >
              <Icon name={sheetOpen ? "close" : "eye"} size={23} />
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
