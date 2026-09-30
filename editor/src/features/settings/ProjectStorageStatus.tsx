import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  discardProjectRecovery,
  getProjectStorageStatus,
  retryProjectStorage,
  subscribeProjectStorage,
} from "../../app/projectAutosave";
import styles from "./ProjectStorageStatus.module.css";

export function ProjectStorageStatus({ onlyIssues = false }: { onlyIssues?: boolean }) {
  const status = useSyncExternalStore(subscribeProjectStorage, getProjectStorageStatus, getProjectStorageStatus);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardFailure, setDiscardFailure] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const restoreDiscardFocus = useRef(false);
  const restoring = status.phase === "restore-failed" || status.phase === "retrying";
  const failed = restoring || status.storage.phase === "error";
  useEffect(() => { if (confirmingDiscard) keepButton.current?.focus(); }, [confirmingDiscard]);
  useEffect(() => {
    if (confirmingDiscard || !restoreDiscardFocus.current) return;
    restoreDiscardFocus.current = false;
    discardButton.current?.focus();
  }, [confirmingDiscard]);
  useEffect(() => {
    if (restoring && !status.recoveryBlocked) return;
    setConfirmingDiscard(false);
    setDiscarding(false);
    setDiscardFailure(false);
  }, [restoring, status.recoveryBlocked]);
  if (onlyIssues && !failed) return null;
  const busy = status.phase === "retrying" || status.storage.phase === "saving";
  const cancelDiscard = () => {
    restoreDiscardFocus.current = true;
    setConfirmingDiscard(false);
    setDiscardFailure(false);
  };
  return <section className={styles.status} aria-label="Project storage"
    onKeyDown={event => { if (confirmingDiscard && event.key === "Escape") { event.preventDefault(); cancelDiscard(); } }}>
    <h3>Browser storage</h3>
    {restoring ? <>
      <p>{confirmingDiscard
        ? "Permanently discard the saved edit? This can’t be undone."
        : status.recoveryBlocked
        ? "Recovery is paused to protect this session and the saved project. Export your current work before reloading to try recovery again."
        : "Automatic saving is paused while your previous project is unreadable. Retry recovery before creating new work."}</p>
      {discardFailure && <p className={styles.failure} role="alert">The saved edit couldn’t be discarded. Retry, or keep it and reload.</p>}
      {confirmingDiscard ? <div className={styles.actions}>
        <button ref={keepButton} type="button" disabled={busy || discarding} onClick={cancelDiscard}>Keep saved edit</button>
        <button type="button" className={styles.danger} disabled={busy || discarding || status.recoveryBlocked} onClick={() => {
          setDiscarding(true);
          void discardProjectRecovery().then(discarded => {
            if (!discarded) { setDiscarding(false); setDiscardFailure(true); }
          });
        }}>{discarding ? "Discarding…" : "Discard and continue"}</button>
      </div> : <div className={styles.actions}>
        <button type="button" disabled={busy || status.recoveryBlocked} onClick={() => { void retryProjectStorage(); }}>
          {busy ? "Recovering…" : "Retry restore"}
        </button>
        {!status.recoveryBlocked && <button ref={discardButton} type="button" className={styles.danger} disabled={busy}
          onClick={() => { setDiscardFailure(false); setConfirmingDiscard(true); }}>Discard saved edit</button>}
      </div>}
    </> : failed ? <>
      <p>Current changes are still in this session. Keep this tab open and retry saving, or export your work.</p>
      <button type="button" disabled={busy} onClick={() => { void retryProjectStorage(); }}>Retry save</button>
    </> : <p>{status.storage.dirty ? "Saving changes in this browser…" : "Changes stay in this browser."}</p>}
  </section>;
}
