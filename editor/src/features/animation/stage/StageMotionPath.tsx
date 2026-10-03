import { useMemo, type CSSProperties } from "react";
import { getAuthoringKeys, getAuthoringLayer, readAuthoringValue } from "../../../domain/animation/authoring";
import type { AnimationTarget } from "../../../domain/animation/model";
import { layerZ } from "../../../domain/layers/order";
import type { LayerId } from "../../../domain/layers/model";
import { getAnimationTarget } from "../../../domain/animation/targets";
import { useAnimationSelection } from "../../../state/animation/selection";
import { useCapture } from "../../../state/captureStore";
import { motionPath } from "./motionPath";
import { trackedStageBox } from "./trackingBox";
import styles from "./StageMotionPath.module.css";

export function StageMotionPath({ width, height, pathDots = true }: { width: number; height: number; pathDots?: boolean }) {
  const state = useCapture();
  const selection = useAnimationSelection(value => value.selection);
  const scene = state.scenes.find(item => item.id === state.currentSceneId);
  const target: AnimationTarget | null = state.selText !== null ? { kind: "text", id: state.selText }
    : state.selComp ? { kind: "component", id: state.selComp }
      : state.sel >= 0 && state.clips[state.sel] ? { kind: "clip", id: state.clips[state.sel].id } : null;
  const targetId = target && "id" in target ? target.id : null;
  const geometry = useMemo(() => {
    if (!scene || !target) return null;
    const layer = getAuthoringLayer(scene, target);
    if (!layer || layer.audio) return null;
    const keys = getAuthoringKeys(scene, target, "position");
    const animation = getAnimationTarget(scene, target)?.animation;
    if (!animation?.tracks.x?.length && !animation?.tracks.y?.length) return null;
    const path = motionPath({ start: layer.start, end: layer.end, keyTimes: keys.map(key => key.time), width, height, pathDots,
      valueAt: time => {
        const position = readAuthoringValue(scene, target, "position", time);
        return typeof position === "number" ? { x: 50, y: 50 } : position;
      } });
    return { ...path, color: layer.color, start: layer.start, end: layer.end };
  }, [scene, target?.kind, targetId, width, height, pathDots]);
  if (!geometry || !target || state.tryMode || state.playheadPick || state.recording || state.importing
    || state.ex === "running" || state.t < geometry.start || state.t > geometry.end) return null;
  // Handles sit underneath the selected overlay's hit surface, just as in the
  // handoff. Its current-position diamond must not steal a drag on the layer.
  const layerId: LayerId = target.kind === "text" ? `text:${target.id}`
    : target.kind === "component" ? `component:${target.id}` : "video";
  const handleZ = target.kind === "clip" ? 10002 : layerZ(scene!, layerId) - 1;
  const tracked = trackedStageBox(state, scene!.id, target, state.t);
  return <div className={styles.path} data-animation-motion-path
    style={{ "--animation-track-color": geometry.color } as CSSProperties}>
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={geometry.points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
        fill="none" stroke="rgba(242,240,233,.35)" strokeWidth="1" strokeDasharray="2 3" />
      {geometry.dots.map(point => <circle key={point.time} cx={point.x} cy={point.y} r="2" fill="rgba(242,240,233,.72)" />)}
    </svg>
    {tracked && <div className={styles.tracked} data-animation-tracked-box
      style={{ left: (tracked.x - tracked.width / 2) * width, top: (tracked.y - tracked.height / 2) * height,
        width: tracked.width * width, height: tracked.height * height }}>
      <span>✦ {tracked.label}</span>
    </div>}
    {geometry.keys.map(key => {
      const selected = selection?.sceneId === scene!.id && selection.target.kind === target.kind
        && "id" in selection.target && selection.target.id === targetId
        && (selection.group === "position" || state.sheet === "animation")
        && Math.abs(selection.time - key.time) < .000001;
      return <button type="button" key={key.time} className={styles.handle}
        data-animation-path-key data-keyframe-control aria-label={`Position keyframe at ${Number(key.time.toFixed(3))} seconds`}
        title={`Position · ${key.time.toFixed(2)}s`} aria-pressed={selected}
        style={{ left: key.x, top: key.y, zIndex: handleZ }}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
        onClick={event => {
          event.stopPropagation();
          useAnimationSelection.getState().select({ sceneId: scene!.id, target, group: "position", time: key.time });
        }}><span className={styles.diamond} /></button>;
    })}
  </div>;
}
