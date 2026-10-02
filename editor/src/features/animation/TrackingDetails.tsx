import type { AnimationTarget } from "../../domain/animation/model";
import type { getLayerTracking } from "../../domain/animation/trackingMetadata";
import { detachLayerTracking, refitLayerTracking } from "../../state/animation/trackingCommands";
import styles from "./TrackingDetails.module.css";

type Tracking = NonNullable<ReturnType<typeof getLayerTracking>>;
export function TrackingDetails({ target, tracking, compact = false, disabled, retrackDisabled = false, onRetrack, perform }: {
  target: AnimationTarget; tracking: Tracking; compact?: boolean; disabled: boolean; retrackDisabled?: boolean; onRetrack(): void;
  perform(operation: () => unknown): unknown;
}) {
  if (target.kind === "audio" || target.kind === "music") return null;
  const visualTarget = target.kind === "component" ? target : { kind: target.kind, id: target.id };
  return <div className={styles.card} data-compact={compact} data-tracked-keyframes>
    <div className={styles.heading}><strong>✦ {compact ? "Tracked" : `“${tracking.label}”`}</strong>
      <span>{tracking.count} keys{compact ? " · drag any ◆" : ""}</span>
      {!compact && <><button type="button" disabled={disabled || retrackDisabled} onClick={onRetrack}>Re-track</button>
        <button type="button" className={styles.detach} disabled={disabled} onClick={() => perform(() => detachLayerTracking(visualTarget))}>Detach</button></>}
    </div>
    <div className={styles.density}>
      {!compact && <span>A key every</span>}
      {([.5, 1, 2] as const).map(step => <button type="button" key={step} aria-pressed={tracking.step === step}
        disabled={disabled} aria-label={`A key every ${step} seconds`} onClick={() => perform(() => refitLayerTracking(visualTarget, step))}>{step === .5 ? "½" : step} s</button>)}
      {compact && <button className={styles.retrack} type="button" disabled={disabled || retrackDisabled} aria-label="Re-track object" onClick={onRetrack}>↻</button>}
    </div>
  </div>;
}
