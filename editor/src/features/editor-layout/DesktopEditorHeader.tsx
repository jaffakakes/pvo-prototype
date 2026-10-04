import { total } from "../../domain/clips/timing";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { startTry, stopTry } from "../preview/tryMode";
import styles from "./EditorHeader.module.css";
import { useSyncExternalStore } from "react";
import { getProjectStorageStatus, subscribeProjectStorage } from "../../app/projectAutosave";
import { showCreateProject } from "../create-project/projectCommands";
import { openSignIn, useAuthGate } from "../../state/auth/authGateStore";
import { requestExport } from "../../state/export/exportCommands";

export function DesktopEditorHeader() {
  const scenes = useCapture(state => state.scenes);
  const currentSceneId = useCapture(state => state.currentSceneId);
  const clips = useCapture(state => state.clips);
  const trying = useCapture(state => !!state.tryMode);
  const canUndo = useCapture(state => state.past.length > 0);
  const canRedo = useCapture(state => state.future.length > 0);
  const projectName = useCapture(state => state.projectName);
  const ratio = useCapture(state => state.ratio);
  const busy = useCapture(state => state.importing || state.ex === "running");
  const user = useAuthGate(state => state.user);
  const storage = useSyncExternalStore(subscribeProjectStorage, getProjectStorageStatus);
  const saveLabel = storage.phase !== "ready" || storage.storage.phase === "error" ? "Save needs attention"
    : storage.storage.dirty ? "Saving in this browser…" : "Saved in this browser";
  const sceneName = scenes.find(scene => scene.id === currentSceneId)?.name ?? "Main";
  const sceneSummary = `${sceneName} · ${fmt(total(clips))} · ${clips.length ? `${clips.length} clip${clips.length === 1 ? "" : "s"}` : "no clips yet"}`;

  if (trying) return <header className={`editorHead ${styles.header}`}>
    <button className={styles.tryButton} onClick={stopTry}>Stop</button>
    <div className={styles.title}>
      <h1>Trying · {sceneName}</h1>
      <p title={sceneSummary}>{sceneSummary}</p>
    </div>
  </header>;

  return <header className={`editorHead ${styles.header}`}>
    <button className={styles.iconButton} onClick={showCreateProject} disabled={busy} aria-label="Back to projects"><Icon name="back" size={19} /></button>
    <div className={styles.title}>
      <h1>{projectName}</h1>
      <p title={`${sceneSummary} · ${saveLabel}`}>{fmt(total(clips))} · {saveLabel}</p>
    </div>
    <button className={styles.iconButton} onClick={() => useCapture.getState().undo()} disabled={!canUndo} aria-label="Undo"><Icon name="undo" size={17} /></button>
    <button className={styles.iconButton} onClick={() => useCapture.getState().redo()} disabled={!canRedo} aria-label="Redo"><Icon name="redo" size={17} /></button>
    <button className={styles.tryButton} onClick={startTry} disabled={!clips.length}>Try</button>
    <span className={styles.ratio}>{ratio}</span>
    <button className={styles.guest} onClick={() => openSignIn()}><i />{user ? "Account" : "Guest"}<span>{user ? user.name : "Sign in"}</span></button>
    <button className={styles.export} onClick={() => requestExport()} disabled={!clips.length || busy} aria-label="Export"><Icon name="export" size={17} /><span>Export</span></button>
    <button className={styles.iconButton} onClick={() => useCapture.getState().patch({ sheet: "more", ratioMenu: false, playing: false, orb: false })} aria-label="More"><Icon name="more" size={20} /></button>
  </header>;
}
