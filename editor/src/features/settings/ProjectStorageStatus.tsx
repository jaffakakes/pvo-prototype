import { useSyncExternalStore } from "react";
import { getProjectStorageStatus, retryProjectStorage, subscribeProjectStorage } from "../../app/projectAutosave";
import styles from "./ProjectStorageStatus.module.css";

export function ProjectStorageStatus({ onlyIssues = false }: { onlyIssues?: boolean }) {
  const status = useSyncExternalStore(subscribeProjectStorage, getProjectStorageStatus, getProjectStorageStatus);
  const restoring = status.phase === "restore-failed" || status.phase === "retrying";
  const failed = restoring || status.storage.phase === "error";
  if (onlyIssues && !failed) return null;
  const busy = status.phase === "retrying" || status.storage.phase === "saving";
  return <section className={styles.status} aria-label="Project storage">
    <h3>Browser storage</h3>
    {restoring ? <>
      <p>{status.recoveryBlocked
        ? "Recovery is paused to protect this session and the saved project. Export your current work before reloading to try recovery again."
        : "Automatic saving is paused while your previous project is unreadable. Retry recovery before creating new work."}</p>
      <button type="button" disabled={busy || status.recoveryBlocked} onClick={() => { void retryProjectStorage(); }}>
        {busy ? "Recovering…" : "Retry restore"}
      </button>
    </> : failed ? <>
      <p>Current changes are still in this session. Keep this tab open and retry saving, or export your work.</p>
      <button type="button" disabled={busy} onClick={() => { void retryProjectStorage(); }}>Retry save</button>
    </> : <p>{status.storage.dirty ? "Saving changes in this browser…" : "Changes stay in this browser."}</p>}
  </section>;
}
