import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getLayerTracking } from "../../domain/animation/trackingMetadata";
import { getAuthoringKeys, readAuthoringValue } from "../../domain/animation/authoring";
import type { AnimationTarget } from "../../domain/animation/model";
import { beginAnimationGesture } from "../../state/animation/commands";
import { useAnimationSelection } from "../../state/animation/selection";
import { scrubPlayback } from "../../state/editing/playbackCommands";
import { EasingGlyph } from "./EasingChips";
import { formatKeyTime, formatKeyValue, GROUP_LABELS } from "./presentation";
import { useAuthoringModel } from "./useAuthoringModel";
import { usePointerSession } from "./usePointerSession";
import styles from "./AnimationRibbon.module.css";

export function AnimationRibbon({ target }: { target: AnimationTarget }) {
  const model = useAuthoringModel(target);
  const pointer = usePointerSession(error => model.perform(() => { throw error; }));
  const well = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const [width, setWidth] = useState(390);
  useEffect(() => {
    const node = well.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { scene, layer, rows, selected, state, blocked } = model;
  if (!scene || !layer) return null;
  const tracking = getLayerTracking(scene, target);
  const length = layer.end - layer.start;
  if (length <= 0) return null;
  const visibleRows = rows.filter(row => layer.audio ? row.group === "volume" : row.group !== "volume");
  const times = [...new Set(visibleRows.flatMap(row => row.keys.map(key => key.time)))].sort((a, b) => a - b);
  const percent = (time: number) => Math.max(0, Math.min(100, (time - layer.start) / length * 100));
  const keyAt = (time: number) => visibleRows.flatMap(row => row.keys.map(key => ({ ...key, group: row.group }))).find(key => Math.abs(key.time - time) < .001);
  const yAt = (time: number) => layer.audio ? 6 + (1 - Number(readAuthoringValue(scene, target, "volume", time)) / 100) * 48 : 20;
  const step = layer.audio ? Math.max(10, Math.ceil(length / 6 / 10) * 10) : Math.max(1, Math.ceil(length / 6));
  const ticks = Array.from({ length: Math.ceil(length / step) }, (_, index) => index * step)
    .filter(time => time / length * width < width - 30);
  const volume = layer.audio ? getAuthoringKeys(scene, target, "volume") : [];
  const envelope = layer.audio && volume.length ? Array.from({ length: 101 }, (_, index) => {
    const time = layer.start + length * index / 100;
    return `${index},${yAt(time)}`;
  }).join(" ") : "";
  const select = (time: number) => {
    const key = keyAt(time);
    if (key) useAnimationSelection.getState().select({ sceneId: scene.id, target, group: key.group, time });
  };
  return <div className={styles.ribbon} style={{ "--track-color": layer.color } as CSSProperties} data-animation-ribbon>
    <div className={styles.ticks}>{ticks.map(time => <span key={time} style={{ left: `${time / length * 100}%` }}>{formatKeyTime(time).replace(/\.0$/, "")}</span>)}
      <span className={styles.end}>{formatKeyTime(length).replace(/\.0$/, "")}</span></div>
    <div ref={well} className={styles.well} data-audio={layer.audio} aria-label="Animation timeline" onPointerDown={event => {
      if (blocked) return;
      const rect = event.currentTarget.getBoundingClientRect();
      pointer(event, () => ({ move: next => {
        useAnimationSelection.getState().clear();
        const local = Math.round((next.clientX - rect.left - 2) / (rect.width - 4) * length * 20) / 20;
        scrubPlayback(layer.start + Math.max(0, Math.min(length, local)));
      }, finish: () => {} }), true);
    }}>
      {tracking && <i className={styles.trackedBand} style={{ left: `${percent(tracking.observation.start)}%`, width: `${percent(tracking.observation.end) - percent(tracking.observation.start)}%` }} />}
      {envelope && <svg className={styles.envelope} viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><polyline points={envelope} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg>}
      {times.slice(0, -1).map((time, index) => {
        const key = keyAt(time)!;
        const next = times[index + 1];
        const span = percent(next) - percent(time);
        return <span key={`segment:${time}`}>
          {!layer.audio && <i className={styles.segment} data-hold={key.easing === "hold"} style={{ left: `${percent(time)}%`, width: `${span}%` }} />}
          {span / 100 * width > 34 && <button type="button" className={styles.pill} disabled={blocked} data-keyframe-control
            style={{ left: `${percent(time) + span / 2}%`, top: (yAt(time) + yAt(next)) / 2 }}
            aria-label={`Edit easing from ${formatKeyTime(time - layer.start)}`} onPointerDown={event => { event.stopPropagation(); }}
            onClick={() => select(time)}><EasingGlyph easing={key.easing} /></button>}
        </span>;
      })}
      {times.map(time => {
        const key = keyAt(time)!;
        const active = !!selected && Math.abs(selected.time - time) < .001;
        return <button type="button" key={time} className={styles.key} disabled={blocked} aria-pressed={active} data-keyframe-control
          aria-label={`Keyframe at ${formatKeyTime(time - layer.start)}`} title={`${GROUP_LABELS[key.group]} · ${formatKeyValue(key.group, key.value)}`}
          style={{ left: `${percent(time)}%`, top: yAt(time) }} onClick={() => { if (!dragged.current) select(time); dragged.current = false; }}
          onPointerDown={event => {
            if (blocked) return;
            dragged.current = false;
            const startX = event.clientX;
            select(time);
            pointer(event, () => {
              let gesture: ReturnType<typeof beginAnimationGesture> | null = null;
              return { move: next => {
                const distance = next.clientX - startX;
                if (!gesture && Math.abs(distance) < 3) return;
                dragged.current = true;
                gesture ??= beginAnimationGesture(target);
                gesture?.moveKey(key.group, time, time + distance / width * length, !layer.audio);
              }, finish: cancelled => { if (cancelled) gesture?.cancel(); else gesture?.commit(); } };
            });
          }}><i /></button>;
      })}
      <i className={styles.playhead} style={{ left: `${percent(state.t)}%` }}><b /></i>
    </div>
    {model.error && <p role="alert">{model.error}</p>}
  </div>;
}
