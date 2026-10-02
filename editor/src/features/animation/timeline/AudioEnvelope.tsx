import type { CSSProperties } from "react";
import {
  getAuthoringKeys,
  getAuthoringLayer,
  readAuthoringValue,
} from "../../../domain/animation/authoring";
import type { AnimationTarget } from "../../../domain/animation/model";
import type { Scene } from "../../../domain/project/model";
import styles from "./AudioEnvelope.module.css";

/** Read-only volume overview on the audio bar; property lanes own editing. */
export function AudioEnvelope({
  scene,
  target,
  zoom,
  offset = false,
}: {
  scene: Scene;
  target: AnimationTarget;
  zoom: number;
  offset?: boolean;
}) {
  const layer = getAuthoringLayer(scene, target);
  if (!layer) return null;
  const keys = getAuthoringKeys(scene, target, "volume");
  const width = (layer.end - layer.start) * zoom;
  if (width <= 0) return null;
  const y = (value: number | { x: number; y: number }) =>
    3 + (1 - (typeof value === "number" ? value : 100) / 100) * 18;
  const points = [
    `0,${y(readAuthoringValue(scene, target, "volume", layer.start))}`,
    ...keys.flatMap((key, index) => {
      const x = (key.time - layer.start) * zoom;
      const previous = keys[index - 1];
      return previous?.easing === "hold"
        ? [`${x},${y(previous.value)}`, `${x},${y(key.value)}`]
        : [`${x},${y(key.value)}`];
    }),
    `${width},${y(readAuthoringValue(scene, target, "volume", layer.end))}`,
  ].join(" ");
  return (
    <svg
      className={styles.envelope}
      aria-hidden="true"
      data-volume-envelope
      width={width}
      height="24"
      viewBox={`0 0 ${width} 24`}
      style={{ left: offset ? layer.start * zoom : 0 } as CSSProperties}
    >
      <polyline
        points={points}
        fill="none"
        stroke="#5cf0c0"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {keys.map((key, index) => (
        <rect
          key={index}
          width="7"
          height="7"
          rx="1"
          fill="#5cf0c0"
          stroke="#000"
          strokeWidth="1.5"
          transform={`translate(${(key.time - layer.start) * zoom} ${y(key.value)}) rotate(45) translate(-3.5 -3.5)`}
        />
      ))}
    </svg>
  );
}
