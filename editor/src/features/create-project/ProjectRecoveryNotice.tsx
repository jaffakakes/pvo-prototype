import { useEffect, useRef, useState } from "react";
import styles from "./CreateProject.module.css";

type Props = {
  blocked: boolean;
  busy: boolean;
  onRetry(): Promise<void>;
  onDiscard(): Promise<boolean>;
};

/** Keeps destructive recovery explicit while leaving staged uploads untouched. */
export function ProjectRecoveryNotice({ blocked, busy, onRetry, onDiscard }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [failure, setFailure] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const restoreDiscardFocus = useRef(false);
  const working = busy || discarding;
  useEffect(() => { if (confirming) keepButton.current?.focus(); }, [confirming]);
  useEffect(() => {
    if (confirming || !restoreDiscardFocus.current) return;
    restoreDiscardFocus.current = false;
    discardButton.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (!blocked) return;
    setConfirming(false);
    setDiscarding(false);
    setFailure(false);
  }, [blocked]);

  if (blocked) return <section className={styles.recovery} aria-label="Saved edit recovery">
    <strong>Saved edit recovery is paused</strong>
    <p>This session contains new work, so the app won’t replace it with the saved edit. Export this work before reloading.</p>
  </section>;

  const discard = async () => {
    setDiscarding(true);
    const discarded = await onDiscard();
    if (!discarded) {
      setDiscarding(false);
      setFailure(true);
    }
  };
  const cancel = () => {
    restoreDiscardFocus.current = true;
    setConfirming(false);
    setFailure(false);
  };

  return <section className={styles.recovery} aria-label="Saved edit recovery"
    onKeyDown={event => { if (confirming && event.key === "Escape") { event.preventDefault(); cancel(); } }}>
    <strong>{confirming ? "Discard the saved edit?" : "Your saved edit couldn’t be opened"}</strong>
    <p>{confirming
      ? "This permanently removes that saved edit. Anything staged on this page will stay."
      : "Starting a new edit is paused so the saved edit isn’t overwritten. Retry it, or discard it and continue with a new edit."}</p>
    {failure && <p className={styles.recoveryFailure} role="alert">The saved edit couldn’t be discarded. Retry, or keep it and reload.</p>}
    <div className={styles.recoveryActions}>
      {confirming ? <>
        <button ref={keepButton} type="button" disabled={working} onClick={cancel}>Keep saved edit</button>
        <button type="button" className={styles.danger} disabled={working} onClick={() => { void discard(); }}>
          {discarding ? "Discarding…" : "Discard and continue"}
        </button>
      </> : <>
        <button type="button" disabled={working} onClick={() => { void onRetry(); }}>
          {busy ? "Retrying…" : "Retry restore"}
        </button>
        <button ref={discardButton} type="button" className={styles.danger} disabled={working}
          onClick={() => { setFailure(false); setConfirming(true); }}>Discard saved edit</button>
      </>}
    </div>
  </section>;
}
