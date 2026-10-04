import { sceneDuration } from "../../domain/scenes/duration";
import { useSyncExternalStore } from "react";
import { getProjectStorageStatus, subscribeProjectStorage } from "../../app/projectAutosave";
import { useCapture } from "../../state/captureStore";
import { openSignIn, useAuthGate } from "../../state/auth/authGateStore";
import { requestExport } from "../../state/export/exportCommands";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { showCreateProject } from "../create-project/projectCommands";
import { RATIO_LABELS } from "./projectPresentation";
import styles from "./DesktopHeader.module.css";

export function DesktopHeader({ onOpenProject }: { onOpenProject(): void }) {
  const duration = useCapture(sceneDuration);
  const projectName = useCapture(state => state.projectName);
  const scene = useCapture(state => state.scenes.find(item => item.id === state.currentSceneId));
  const ratio = useCapture(state => state.ratio);
  const busy = useCapture(state => state.importing || state.ex === "running");
  const trying = useCapture(state => !!state.tryMode);
  const user = useAuthGate(state => state.user);
  const storage = useSyncExternalStore(subscribeProjectStorage, getProjectStorageStatus);
  const saveLabel = storage.phase !== "ready" || storage.storage.phase === "error"
    ? "Save needs attention"
    : storage.storage.dirty ? "Saving in this browser…" : "Saved in this browser";

  return <header className={styles.header}>
    <button type="button" className={styles.mark} aria-label="Back to projects"
      disabled={busy || trying} onClick={showCreateProject}>
      <img src="restyle-mark.png" alt="Restyle" />
    </button>
    <div className={styles.title}>
      <h1 title={projectName}>{projectName}</h1>
      <p>{saveLabel} · {scene?.name ?? "Main"} · {fmt(duration)}</p>
    </div>
    <div className={styles.actions}>
      <span className={styles.guest}><i /><span className={styles.accountName}>{user ? user.name : "Guest"}</span>
        <button type="button" onClick={() => openSignIn()}>{user ? "Account" : "Sign in"}</button>
      </span>
      <button type="button" className={styles.target} onClick={onOpenProject}
        aria-label="Project settings" disabled={trying}>{RATIO_LABELS[ratio]} · {ratio}</button>
      <button type="button" className={styles.export} onClick={() => requestExport()}
        disabled={!duration || busy || trying}>
        <Icon name="export" size={16} />Export
      </button>
    </div>
  </header>;
}
