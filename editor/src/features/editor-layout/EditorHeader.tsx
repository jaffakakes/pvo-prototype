import { AccountMenu } from "../account/AccountMenu";
import { useSyncExternalStore } from "react";
import {
  getProjectStorageStatus,
  subscribeProjectStorage,
} from "../../app/projectAutosave";
import { useCapture } from "../../state/captureStore";
import { openSignIn, useAuthGate } from "../../state/auth/authGateStore";
import { Icon } from "../../ui/Icon";
import { stopTry } from "../preview/tryMode";
import { ProjectSettingsMenu } from "../settings/ProjectSettingsMenu";
import styles from "./EditorHeader.module.css";

export function EditorHeader() {
  const trying = useCapture((state) => !!state.tryMode);
  const user = useAuthGate((state) => state.user);
  const projectName = useCapture((state) => state.projectName);
  const storage = useSyncExternalStore(
    subscribeProjectStorage,
    getProjectStorageStatus,
  );
  let saveLabel = "Not saved yet";
  if (storage.phase === "starting") saveLabel = "Loading…";
  else if (storage.phase === "retrying") saveLabel = "Recovering…";
  else if (
    storage.phase === "restore-failed" ||
    storage.storage.phase === "error"
  )
    saveLabel = "Save needs attention";
  else if (storage.storage.dirty || storage.storage.phase === "saving")
    saveLabel = "Saving…";
  else if (storage.storage.phase === "saved")
    saveLabel = "Saved in this browser";
  const sceneName = useCapture(
    (state) =>
      state.scenes.find((scene) => scene.id === state.currentSceneId)?.name ??
      "Main",
  );
  return (
    <header
      className={`editorHead ${styles.header} ${styles.projectHeader}`}
      data-trying={trying}
      aria-label={trying ? `Trying ${sceneName}` : "Editor navigation"}
    >
      <button
        type="button"
        className={styles.navigationButton}
        onClick={() => {
          if (trying) stopTry();
          else {
            const state = useCapture.getState();
            state.startRecordingIntoScene(state.currentSceneId);
          }
        }}
        aria-label={trying ? "Stop trying" : "Back to camera"}
        title={trying ? "Stop trying" : "Back to camera"}
      >
        <Icon name="back" size={22} />
      </button>
      <div className={styles.projectDetails}>
        <div className={styles.titleRow}>
          <div className={styles.titleField}>
            <span className={styles.titleMeasure} aria-hidden="true">
              {projectName || "Untitled edit"}
            </span>
            <input
              className={styles.projectName}
              aria-label="Project title"
              title="Edit project title"
              placeholder="Untitled edit"
              value={projectName}
              maxLength={120}
              size={1}
              readOnly={trying}
              onChange={(event) =>
                useCapture.getState().patch({ projectName: event.target.value })
              }
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
          {!trying && <ProjectSettingsMenu />}
        </div>
        <p className={styles.saveState}>{saveLabel}</p>
      </div>
      {user && !trying && <AccountMenu />}
      {!user && !trying && (
        <button
          type="button"
          className={`${styles.navigationButton} ${styles.signIn}`}
          onClick={() => openSignIn()}
          aria-label="Sign in"
          title="Sign in"
        >
          Sign in
        </button>
      )}
    </header>
  );
}
