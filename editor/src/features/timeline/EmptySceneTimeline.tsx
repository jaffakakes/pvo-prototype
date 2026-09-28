import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import styles from "./Timeline.module.css";

export function EmptySceneTimeline() {
  return <div className={`${cx("tl")} ${styles.emptyTimeline}`}>
    <div className={`${cx("timelineContent")} ${styles.emptyContent}`}>
      <button type="button" className={styles.emptyAdd} aria-label="Add clip" onClick={() => {
        const state = useCapture.getState();
        state.startRecordingIntoScene(state.currentSceneId);
      }}>＋ Add clip</button>
    </div>
  </div>;
}
