import { getLayerTracking } from "../../../domain/animation/trackingMetadata";
import type { CSSProperties, PointerEvent } from "react";
import {
  getAuthoringKeys,
  getAuthoringLayer,
} from "../../../domain/animation/authoring";
import type { Scene } from "../../../domain/project/model";
import { useAnimationSelection } from "../../../state/animation/selection";
import { EasingGlyph } from "../EasingChips";
import { GROUP_LABELS, formatKeyTime, formatKeyValue } from "../presentation";
import { sameAnimationTarget, type AnimationLane } from "./model";
import { useKeyframeDrag } from "./useKeyframeDrag";
import styles from "./PropertyLane.module.css";

type Props = {
  scene: Scene;
  lane: AnimationLane;
  zoom: number;
  disabled: boolean;
  onScrub: (event: PointerEvent<HTMLElement>) => void;
  style?: CSSProperties;
};

export function PropertyLaneLabel({
  scene,
  lane,
  style,
}: Pick<Props, "scene" | "lane" | "style">) {
  const layer = getAuthoringLayer(scene, lane.target);
  if (!layer) return null;
  const tracked =
    lane.groups.includes("position") && !!getLayerTracking(scene, lane.target);
  return (
    <div
      className={styles.label}
      style={{ ...style, "--key-color": layer.color } as CSSProperties}
      data-single={lane.single}
      data-keyframe-lane-label={lane.single ? "all" : lane.groups[0]}
    >
      <i aria-hidden="true" />
      <span>
        {lane.single
          ? "Keyframes"
          : `${GROUP_LABELS[lane.groups[0]]}${tracked ? " · ✦" : ""}`}
      </span>
    </div>
  );
}

export function PropertyLane({
  scene,
  lane,
  zoom,
  disabled,
  onScrub,
  style,
}: Props) {
  const selection = useAnimationSelection((value) => value.selection);
  const drag = useKeyframeDrag(scene.id, lane.target, zoom, disabled);
  const layer = getAuthoringLayer(scene, lane.target);
  if (!layer) return null;
  const tracking = lane.groups.includes("position")
    ? getLayerTracking(scene, lane.target)
    : null;
  const tracks = lane.groups.map((group) => ({
    group,
    keys: getAuthoringKeys(scene, lane.target, group),
  }));
  const items = tracks.flatMap((track) =>
    track.keys.map((key, index) => ({ ...key, group: track.group, index })),
  );
  const selected =
    selection &&
    selection.sceneId === scene.id &&
    sameAnimationTarget(selection.target, lane.target)
      ? items.find(
          (key) =>
            key.group === selection.group &&
            Math.abs(key.time - selection.time) < 1e-6,
        )
      : undefined;
  const left = (time: number) => (time - layer.start) * zoom;
  const segmentTrack = lane.single
    ? tracks.find((track) => track.group === "position")
    : tracks[0];
  return (
    <div
      className={styles.row}
      style={style}
      data-keyframe-lane={lane.single ? "all" : lane.groups[0]}
      data-single={lane.single}
      data-animation-layer={`${lane.target.kind}:${"id" in lane.target ? lane.target.id : "music"}`}
      onPointerDown={onScrub}
    >
      <div
        className={styles.well}
        style={
          {
            left: layer.start * zoom,
            width: (layer.end - layer.start) * zoom,
            "--key-color": layer.color,
          } as CSSProperties
        }
      >
        {tracking && (
          <i
            className={styles.trackedBand}
            data-tracking-band
            style={{
              left: left(Math.max(layer.start, tracking.observation.start)),
              width:
                (Math.min(layer.end, tracking.observation.end) -
                  Math.max(layer.start, tracking.observation.start)) *
                zoom,
            }}
          />
        )}
        {segmentTrack?.keys.slice(0, -1).map((key, index) => {
          const width = (segmentTrack.keys[index + 1].time - key.time) * zoom;
          return (
            <div
              key={index}
              className={styles.segment}
              style={{ left: left(key.time), width }}
              data-hold={key.easing === "hold"}
            >
              {width > 30 && (
                <button
                  type="button"
                  className={styles.easing}
                  disabled={disabled}
                  aria-label={`Edit easing after ${GROUP_LABELS[segmentTrack.group]} keyframe at ${formatKeyTime(key.time)}`}
                  title="Easing · click to edit"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    drag.select(segmentTrack.group, key.time);
                  }}
                >
                  <EasingGlyph easing={key.easing} />
                </button>
              )}
            </div>
          );
        })}
        {items.map((key) => (
          <button
            type="button"
            key={`${key.group}:${key.index}`}
            className={styles.key}
            style={{ left: left(key.time) }}
            disabled={disabled}
            aria-pressed={key === selected}
            aria-label={`${GROUP_LABELS[key.group]} keyframe at ${formatKeyTime(key.time)}`}
            title={`${GROUP_LABELS[key.group]} · ${formatKeyTime(key.time)} · ${formatKeyValue(key.group, key.value)}`}
            onPointerDown={(event) => drag.begin(event, key.group, key.time)}
            onPointerMove={drag.move}
            onPointerUp={(event) => drag.end(event)}
            onPointerCancel={(event) => drag.end(event, true)}
            onLostPointerCapture={(event) => drag.end(event, true)}
            onClick={(event) => {
              event.stopPropagation();
              if (event.detail === 0) drag.select(key.group, key.time);
            }}
          >
            <i aria-hidden="true" />
          </button>
        ))}
        {selected && (
          <span
            className={styles.value}
            style={{ left: left(selected.time) + 12 }}
          >
            {lane.single ? `${GROUP_LABELS[selected.group]} ` : ""}
            {formatKeyValue(selected.group, selected.value)}
          </span>
        )}
      </div>
      {drag.error && (
        <span className={styles.error} role="alert">
          {drag.error}
        </span>
      )}
    </div>
  );
}
