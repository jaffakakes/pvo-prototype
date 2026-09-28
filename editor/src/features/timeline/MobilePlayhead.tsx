import { cx } from "../../styles";
import { pickTime } from "../../ui/formatTime";
import type { usePlayheadScrub } from "./usePlayheadScrub";
import styles from "./MobilePlayhead.module.css";

export function MobilePlayhead({ scrub, time, duration, disabled }: {
  scrub: ReturnType<typeof usePlayheadScrub>;
  time: number;
  duration: number;
  disabled: boolean;
}) {
  return (
    <div className={cx("playhead")} style={{ left: scrub.x }}>
      <button
        className={styles.handle}
        type="button"
        role="slider"
        aria-label="Timeline playhead"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        aria-valuetext={pickTime(time)}
        disabled={disabled}
        {...scrub.handleProps}
        onClick={event => event.stopPropagation()}
      />
    </div>
  );
}
