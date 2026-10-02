import type { AnimationTarget } from "../../domain/animation/model";
import { fadeAuthoringVolume } from "../../state/animation/commands";
import { useAudioDucking } from "./useAudioDucking";
import styles from "./AudioAnimationActions.module.css";

export function AudioAnimationActions({ target, disabled }: { target: AnimationTarget; disabled: boolean }) {
  const ducking = useAudioDucking(target);
  return <>
    <div className={styles.actions}>
      <button type="button" disabled={disabled || ducking.busy} onClick={() => fadeAuthoringVolume(target, "in")}>Fade in · 0.8s</button>
      <button type="button" disabled={disabled || ducking.busy} onClick={() => fadeAuthoringVolume(target, "out")}>Fade out · 1s</button>
      <button type="button" className={styles.duck} disabled={disabled} onClick={() => ducking.busy ? ducking.cancel() : void ducking.run()}>
        {ducking.busy ? "Cancel ducking" : "✦ Duck under speech"}</button>
    </div>
    {ducking.busy && <p role="status" className={styles.status}>Finding speech in the video…</p>}
    {ducking.error && <p role="alert" className={styles.status}>{ducking.error}</p>}
  </>;
}
