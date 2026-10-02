import type { AnimationGroup } from "../../domain/animation/authoring";
import type { AnimationTarget } from "../../domain/animation/model";
import { addAuthoringKey, removeAuthoringKey, setAuthoringEasing } from "../../state/animation/commands";
import { useAnimationSelection } from "../../state/animation/selection";
import { useLayerFollowing } from "./useLayerFollowing";
import { TrackingDetails } from "./TrackingDetails";
import { TrackingPointPicker } from "./TrackingPointPicker";
import { Icon } from "../../ui/Icon";
import { AnimationSlider } from "./AnimationValueControls";
import { EasingChips } from "./EasingChips";
import { formatKeyTime, formatKeyValue, GROUP_LABELS } from "./presentation";
import { useAuthoringModel } from "./useAuthoringModel";
import styles from "./AnimationInspector.module.css";

/** Desktop property controls and key details share the timeline's selection/commands. */
export function KeyframeEditor({ target, groups }: { target: AnimationTarget; groups?: AnimationGroup[] }) {
  const { state, scene, layer, rows, count, selected, disabled, blocked, outside, error, perform } = useAuthoringModel(target);
  const following = useLayerFollowing(target);
  if (!scene || !layer) return null;
  const shownRows = rows.filter(row => groups ? groups.includes(row.group) : row.group !== "volume" || layer.audio);
  const volumeOnly = shownRows.length === 1 && shownRows[0].group === "volume";
  const picked = selected && shownRows.some(row => row.group === selected.group) ? selected : null;
  return <div className={styles.inspector} data-keyframe-editor data-animation-target={target.kind}>
    <section className={styles.section} aria-label={volumeOnly ? "Audio animation" : "Animated transform"}>
      <header className={styles.heading}><h3>{volumeOnly ? "Volume" : "Transform"}</h3><span>◆ = keyframe at the playhead</span></header>
      <div className={styles.rows}>{shownRows.map(row => {
        const here = row.keys.find(key => Math.abs(key.time - state.t) < .001);
        const previous = row.keys.filter(key => key.time < state.t - .001).at(-1);
        const next = row.keys.find(key => key.time > state.t + .001);
        const select = (time: number) => useAnimationSelection.getState().select({ sceneId: scene.id, target, group: row.group, time });
        return <div className={styles.property} key={row.group} data-animation-property={row.group}>
          <div className={styles.propertyHead}>
            <button className={styles.toggle} type="button" disabled={disabled} data-animated={row.keys.length > 0} aria-pressed={!!here}
              aria-label={here ? `Remove ${GROUP_LABELS[row.group]} keyframe` : `Add ${GROUP_LABELS[row.group]} keyframe`}
              title={here ? "Remove this keyframe" : row.keys.length ? `Add a keyframe at ${formatKeyTime(state.t - layer.start)}` : `Animate ${GROUP_LABELS[row.group].toLowerCase()}`}
              onClick={() => perform(() => here ? removeAuthoringKey(target, state.t, { group: row.group }) : addAuthoringKey(target, state.t, { group: row.group }))}><i /></button>
            <span className={styles.propertyLabel}>{GROUP_LABELS[row.group]}</span>
            {row.keys.length > 0 && <span className={styles.navigation}>
              <button type="button" aria-label={`Previous ${GROUP_LABELS[row.group]} keyframe`} disabled={blocked || !previous} onClick={() => previous && select(previous.time)}>‹</button>
              <button type="button" aria-label={`Next ${GROUP_LABELS[row.group]} keyframe`} disabled={blocked || !next} onClick={() => next && select(next.time)}>›</button>
            </span>}
            <output className={styles.value} data-keyed={!!here}>{formatKeyValue(row.group, row.value)}</output>
          </div>
          {row.group !== "position" && typeof row.value === "number" && <div className={styles.slider}>
            <AnimationSlider target={target} group={row.group} value={row.value} time={state.t} disabled={disabled} hideLabel />
          </div>}
        </div>;
      })}</div>
    </section>
    <section className={styles.section} aria-label="Animation details">
      <header className={styles.heading}><h3>Animation</h3><span>{count} keyframes</span></header>
      {!volumeOnly && following.tracking && <TrackingDetails target={target} tracking={following.tracking} disabled={blocked || following.phase !== "idle"} onRetrack={following.retrack} perform={perform} />}
      {picked ? <div className={styles.card} data-selected-key-card>
        <div className={styles.cardHead}><i className={styles.diamond} /><strong>{GROUP_LABELS[picked.group]} · {formatKeyTime(picked.time - layer.start)}</strong>
          <span>{formatKeyValue(picked.group, picked.value)}</span>
          <button type="button" className={styles.delete} disabled={blocked} title="Delete keyframe · ⌫" onClick={() => perform(() => removeAuthoringKey(target, picked.time, { group: picked.group }))}>
            <Icon name="trash" size={12} />Delete</button>
        </div>
        <p>To the next keyframe</p>
        <EasingChips value={picked.easing} compact disabled={blocked} onChange={easing => perform(() => setAuthoringEasing(target, picked.group, picked.time, easing))} />
      </div> : <p className={styles.note}>{outside ? "Move the playhead into this layer to animate it." : "Click a ◆ on the timeline to edit it. Move the playhead and drag the layer (or a slider) to add one there."}</p>}
      {!volumeOnly && !following.tracking && following.phase === "idle" && <button type="button" className={styles.follow} disabled={blocked} onClick={() => void following.pick()}>✦ Follow something on the video…</button>}
      {following.phase !== "idle" && <p className={styles.note} role="status">{following.phase === "frame" ? "Reading the video…" : "Tracking the selected object…"} <button className={styles.follow} type="button" onClick={following.cancel}>Cancel</button></p>}
      {following.error && <p className={styles.error} role="alert">{following.error}</p>}
      {following.frame && <TrackingPointPicker frame={following.frame} onPick={following.choose} onCancel={following.cancel} />}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  </div>;
}
