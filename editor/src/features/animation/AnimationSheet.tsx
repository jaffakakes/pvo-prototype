import { useCallback, useEffect } from "react";
import { selectedAuthoringTarget, addAuthoringKey, removeAuthoringKey, setAuthoringEasing } from "../../state/animation/commands";
import { useLayerFollowing } from "./useLayerFollowing";
import { TrackingDetails } from "./TrackingDetails";
import { TrackingPointPicker } from "./TrackingPointPicker";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { useSheetDock } from "../../ui/sheets/SheetDockContext";
import { SOUNDS } from "../sound/catalog";
import { AnimationRibbon } from "./AnimationRibbon";
import { AnimationSlider, PositionPad } from "./AnimationValueControls";
import { EasingChips } from "./EasingChips";
import { AudioAnimationActions } from "./AudioAnimationActions";
import { useAuthoringModel } from "./useAuthoringModel";
import { GROUP_LABELS, formatKeyTime, formatKeyValue } from "./presentation";
import type { AnimationTarget } from "../../domain/animation/model";
import styles from "./AnimationSheet.module.css";

export function AnimationSheet() {
  const state = useCapture();
  const target = selectedAuthoringTarget(state);
  const close = useCallback(() => useCapture.getState().patch({ sheet: null }), []);
  const dock = useSheetDock();
  const registerDismiss = dock?.registerDismiss;
  useEffect(() => registerDismiss?.(close), [registerDismiss, close]);
  return <section className={styles.sheet} role="dialog" aria-label="Animate" data-animation-sheet>
    {target ? <AnimateLayer key={`${target.kind}:${"id" in target ? target.id : "music"}`} target={target} close={close} />
      : <><header className={styles.header}><h2>Animate</h2><button type="button" onClick={close} aria-label="Close"><Icon name="close" size={17} /></button></header><p>Select a layer to animate.</p></>}
  </section>;
}

function AnimateLayer({ target, close }: { target: AnimationTarget; close(): void }) {
  const { state, scene, layer, rows, selected, blocked, disabled, error, perform } = useAuthoringModel(target);
  const following = useLayerFollowing(target);
  if (!scene || !layer) return null;
  const shownRows = rows.filter(row => layer.audio ? row.group === "volume" : row.group !== "volume");
  const atPlayhead = shownRows.filter(row => row.keys.some(key => Math.abs(key.time - state.t) < .001));
  const position = shownRows.find(row => row.group === "position");
  const volume = shownRows.find(row => row.group === "volume");
  const label = target.kind === "music" ? SOUNDS[state.sound]?.name ?? layer.label : layer.label;
  const kind = target.kind === "text" ? "title" : target.kind === "clip" ? "video" : target.kind;
  const localTime = Math.max(0, state.t - layer.start);
  const selectedTime = selected?.time;
  const easeKey = selected ? selected : atPlayhead[0]?.keys.find(key => Math.abs(key.time - state.t) < .001);
  const easeGroup = selected?.group ?? atPlayhead[0]?.group;
  return <>
    <header className={styles.header}>
      <span className={styles.icon}><Icon name="keyframe" size={20} /></span>
      <div className={styles.title}><h2>Animate</h2><p>{label} · {kind} · {following.tracking ? `following ${following.tracking.label}` : `${formatKeyTime(layer.start).replace(/\.0$/, "")}–${formatKeyTime(layer.end).replace(/\.0$/, "")}`}</p></div>
      {!layer.audio && following.available && !following.tracking && <button className={styles.follow} type="button" disabled={blocked || following.phase !== "idle"} onClick={() => void following.pick()}>✦ Follow…</button>}
      <button className={styles.close} type="button" onClick={close} aria-label="Close Animate"><Icon name="close" size={17} /></button>
    </header>
    <div className={styles.body} data-sheet-body>
      <AnimationRibbon target={target} />
      <div className={styles.keyRow}>
        {following.tracking ? <TrackingDetails target={target} tracking={following.tracking} compact disabled={blocked || following.phase !== "idle"}
          retrackDisabled={!following.available} onRetrack={following.retrack} perform={perform} /> : <>
        <div className={styles.keyDescription}><strong>{atPlayhead.length ? "◆ " : ""}{formatKeyTime(localTime)}</strong>
          <span>{atPlayhead.length ? layer.audio ? formatKeyValue("volume", volume!.value) : atPlayhead.map(row => GROUP_LABELS[row.group]).join(" · ")
            : layer.audio ? `between keyframes · volume ${formatKeyValue("volume", volume!.value)}` : "no keyframe here · add one before dragging to animate"}</span></div>
        <button type="button" className={styles.keyAction} data-delete={!!atPlayhead.length} disabled={disabled} data-keyframe-control
          onClick={() => perform(() => atPlayhead.length ? removeAuthoringKey(target, state.t, { wholeTransform: !layer.audio, group: layer.audio ? "volume" : undefined })
            : addAuthoringKey(target, state.t, { wholeTransform: !layer.audio, group: layer.audio ? "volume" : undefined }))}>
          <Icon name={atPlayhead.length ? "trash" : "keyframe"} size={14} />{atPlayhead.length ? "Delete" : "Keyframe"}</button></>}
      </div>
      {layer.audio && volume && typeof volume.value === "number" ? <div className={styles.audio}>
        <AnimationSlider target={target} group="volume" value={volume.value} time={state.t} disabled={disabled} ruler />
        <AudioAnimationActions target={target} disabled={blocked} />
      </div> : <div className={styles.transform}>
        {position && <PositionPad target={target} value={position.value} time={state.t} disabled={disabled} />}
        <div className={styles.rulers}>{shownRows.filter(row => row.group !== "position").map(row => typeof row.value === "number" && row.group !== "position"
          ? <AnimationSlider key={row.group} target={target} group={row.group} value={row.value} time={state.t} disabled={disabled} wholeTransform ruler /> : null)}</div>
      </div>}
      <div className={styles.easing}><span>To next</span><EasingChips value={easeKey?.easing ?? null} disabled={blocked || !easeKey || !easeGroup}
        onChange={easing => easeKey && easeGroup && perform(() => setAuthoringEasing(target, easeGroup, selectedTime ?? state.t, easing, { wholeTransform: !layer.audio }))} /></div>
      {following.phase !== "idle" && <p className={styles.error} role="status">{following.phase === "frame" ? "Reading the video…" : "Tracking the selected object…"} <button type="button" onClick={following.cancel}>Cancel</button></p>}
      {following.error && <p className={styles.error} role="alert">{following.error}</p>}
      {following.frame && <TrackingPointPicker frame={following.frame} onPick={following.choose} onCancel={following.cancel} />}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </>;
}
