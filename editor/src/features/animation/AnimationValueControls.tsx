import { useState, type CSSProperties } from "react";
import type { AnimationGroup, AuthoringValue } from "../../domain/animation/authoring";
import type { AnimationTarget } from "../../domain/animation/model";
import { beginAnimationGesture, setAuthoringValue } from "../../state/animation/commands";
import { CONTROL_RANGES, GROUP_LABELS, formatKeyValue } from "./presentation";
import { usePointerSession } from "./usePointerSession";
import styles from "./AnimationValueControls.module.css";

type Props = { target: AnimationTarget; group: Exclude<AnimationGroup, "position">; time: number;
  value: number; disabled: boolean; wholeTransform?: boolean; ruler?: boolean; hideLabel?: boolean };

export function AnimationSlider({ target, group, time, value, disabled, wholeTransform = false, ruler = false, hideLabel = false }: Props) {
  const [error, setError] = useState<string | null>(null);
  const pointer = usePointerSession(failure => setError(failure instanceof Error ? failure.message : "This keyframe could not be changed."));
  const range = CONTROL_RANGES[group];
  const percent = Math.max(0, Math.min(100, (value - range.min) / (range.max - range.min) * 100));
  return <div className={styles.control} data-ruler={ruler} data-volume={group === "volume"}>
    {!hideLabel && <div className={styles.label}><span>{GROUP_LABELS[group]}</span><output>{formatKeyValue(group, value)}</output></div>}
    <div className={styles.slider} role="slider" tabIndex={disabled ? -1 : 0} aria-label={GROUP_LABELS[group]}
      aria-valuenow={value} aria-valuemin={range.min} aria-valuemax={range.max} aria-disabled={disabled}
      aria-valuetext={formatKeyValue(group, value)} style={{ "--fill": `${percent}%` } as CSSProperties}
      onKeyDown={event => {
        if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
        const next = event.key === "Home" ? range.min : event.key === "End" ? range.max : value + direction * range.step;
        try { setError(null); setAuthoringValue(target, group, time, Math.max(range.min, Math.min(range.max, next)), { wholeTransform }); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "This keyframe could not be changed."); }
      }} onPointerDown={event => {
        if (disabled) return;
        setError(null);
        const rect = event.currentTarget.getBoundingClientRect();
        pointer(event, () => {
          const gesture = beginAnimationGesture(target);
          return { move: next => {
            const fraction = Math.max(0, Math.min(1, (next.clientX - rect.left) / rect.width));
            const nextValue = Math.round((range.min + fraction * (range.max - range.min)) / range.step) * range.step;
            gesture?.setValue(group, time, nextValue, wholeTransform);
          }, finish: cancelled => cancelled ? gesture?.cancel() : gesture?.commit() };
        }, true);
      }}><span className={styles.fill} /><span className={styles.knob} /></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}

export function PositionPad({ target, time, value, disabled }: { target: AnimationTarget; time: number; value: AuthoringValue; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const pointer = usePointerSession(failure => setError(failure instanceof Error ? failure.message : "This keyframe could not be changed."));
  if (typeof value === "number") return null;
  return <div className={styles.position}>
    <div className={styles.pad} role="group" aria-label="Position pad" aria-disabled={disabled} onPointerDown={event => {
      if (disabled) return;
      setError(null);
      const rect = event.currentTarget.getBoundingClientRect();
      pointer(event, () => {
        const gesture = beginAnimationGesture(target);
        return { move: next => gesture?.setValue("position", time, {
          x: Math.max(8, Math.min(92, (next.clientX - rect.left) / rect.width * 100)),
          y: Math.max(6, Math.min(94, (next.clientY - rect.top) / rect.height * 100)),
        }, true), finish: cancelled => cancelled ? gesture?.cancel() : gesture?.commit() };
      }, true);
    }}>
      <i className={styles.crossX} /><i className={styles.crossY} />
      <b style={{ left: `${value.x}%`, top: `${value.y}%` }} />
      <button className={styles.padKeyboard} type="button" disabled={disabled} aria-label={`Position: ${formatKeyValue("position", value)}. Use arrow keys to move.`}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const step = event.shiftKey ? 5 : 1;
          try {
            setError(null);
            setAuthoringValue(target, "position", time, {
              x: Math.max(8, Math.min(92, value.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0))),
              y: Math.max(6, Math.min(94, value.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0))),
            }, { wholeTransform: true });
          } catch (failure) { setError(failure instanceof Error ? failure.message : "This keyframe could not be changed."); }
        }} />
    </div>
    <div className={styles.readout}>Position · <span>{formatKeyValue("position", value)}</span></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
