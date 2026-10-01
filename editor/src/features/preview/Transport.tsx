import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { fmt,pickTime } from "../../ui/formatTime";
import { togglePlayback } from "./playbackCommands";
import styles from "./Transport.module.css";

export function Transport() {
  const s = useCapture();
  return <div className={`${cx("transport")} ${styles.transport}`}>
    <div className={`${cx("transportTime")} ${styles.time}`}>{s.playheadPick ? pickTime(s.t) : fmt(s.t)} <span>/ {fmt(sceneDuration(s))}</span></div>
    <button className={`${cx("playBtn press")} ${styles.play}`} onClick={togglePlayback} aria-label={s.playing ? "Pause" : "Play"} disabled={!!s.tryMode?.holdingId}><Icon name={s.playing ? "pause" : "play"} size={s.playing ? 18 : 20} /></button>
  </div>;
}
