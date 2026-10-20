import type { CSSProperties } from "react";
import { locate, total } from "../../domain/clips/timing";
import type { Scene } from "../../domain/project/model";
import { ClipPoster } from "../../ui/media/ClipPoster";
import { pickTime } from "../../ui/formatTime";
import styles from "./CoverPicker.module.css";

export function CoverFilmstrip({
  scene,
  time,
  maximum,
  onTime,
  label = "Pick a cover frame",
}: {
  label?: string;
  scene: Scene;
  time: number;
  maximum: number;
  onTime(time: number): void;
}) {
  const frames = Array.from({ length: 8 }, (_, index) => {
    const at = (maximum * index) / 7;
    return at < total(scene.clips) ? locate(at, scene.clips) : null;
  });
  return (
    <div
      className={styles.filmstrip}
      style={
        {
          "--cover-position": `${maximum > 0 ? (time / maximum) * 100 : 0}%`,
        } as CSSProperties
      }
    >
      <div className={styles.frames} aria-hidden="true">
        {frames.map((frame, index) => (
          <span key={index} className={styles.frame}>
            {frame && (
              <ClipPoster
                clip={{ url: frame.c.url, in: frame.lt, color: frame.c.color }}
              />
            )}
          </span>
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={maximum}
        step={0.01}
        value={time}
        aria-label={label}
        aria-valuetext={pickTime(time)}
        onChange={(event) => onTime(Number(event.currentTarget.value))}
      />
      <span className={styles.marker} aria-hidden="true" />
    </div>
  );
}
