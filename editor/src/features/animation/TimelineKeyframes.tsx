import type { CSSProperties } from "react";
import { AUTHORING_PROPERTIES } from "../../domain/animation/authoring";
import type { LayerAnimation } from "../../domain/animation/model";
import styles from "./TimelineKeyframes.module.css";

/** Read-only bar overview. Desktop property lanes and the phone sheet own editing. */
export function TimelineKeyframes({
  animation,
  start,
  end,
  color = "#FFD23E",
}: {
  animation: LayerAnimation | undefined;
  start: number;
  end: number;
  color?: string;
}) {
  if (!animation || end <= start) return null;
  const groupTimes = Object.values(AUTHORING_PROPERTIES).map((properties) => [
    ...new Set(
      properties.flatMap((property) =>
        (animation.tracks[property] ?? [])
          .filter((frame) => frame.time >= start && frame.time <= end)
          .map((frame) => frame.time),
      ),
    ),
  ]);
  const times = [...new Set(groupTimes.flat())].sort((a, b) => a - b);
  if (!times.length) return null;
  const count = groupTimes.reduce((total, group) => total + group.length, 0);
  const stride = Math.max(1, Math.ceil(times.length / 48));
  return (
    <i
      className={styles.overview}
      aria-hidden="true"
      data-timeline-keyframes={count}
      style={{ "--key-color": color } as CSSProperties}
    >
      <span className={styles.badge}>◆ {count}</span>
      <span className={styles.markers}>
        {times
          .filter(
            (_, index) => index % stride === 0 || index === times.length - 1,
          )
          .map((time) => (
            <b
              key={time}
              style={{ left: `${((time - start) / (end - start)) * 100}%` }}
            />
          ))}
      </span>
    </i>
  );
}
