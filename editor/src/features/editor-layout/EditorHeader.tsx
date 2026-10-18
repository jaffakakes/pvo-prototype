import { useCapture } from "../../state/captureStore";
import { openSignIn, useAuthGate } from "../../state/auth/authGateStore";
import { Icon } from "../../ui/Icon";
import { stopTry } from "../preview/tryMode";
import styles from "./EditorHeader.module.css";

export function EditorHeader() {
  const trying = useCapture((state) => !!state.tryMode);
  const user = useAuthGate((state) => state.user);
  const sceneName = useCapture(
    (state) =>
      state.scenes.find((scene) => scene.id === state.currentSceneId)?.name ??
      "Main",
  );
  return (
    <header
      className={`editorHead ${styles.header} ${styles.overlay}`}
      data-trying={trying}
      aria-label={trying ? `Trying ${sceneName}` : "Editor navigation"}
    >
      <button
        type="button"
        className={`${styles.navigationButton} ${styles.back}`}
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
        <span className={styles.navigationLabel}>
          {trying ? "Stop trying" : "Back"}
        </span>
      </button>
      {!user && !trying && (
        <button
          type="button"
          className={`${styles.navigationButton} ${styles.signIn}`}
          onClick={() => openSignIn()}
          aria-label="Sign in"
          title="Sign in"
        >
          <Icon name="user" size={22} />
          <span className={styles.navigationLabel}>Sign in</span>
        </button>
      )}
    </header>
  );
}
