import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { stopTry } from "../preview/tryMode";
import styles from "./EditorHeader.module.css";

export function EditorHeader() {
  const trying = useCapture((state) => !!state.tryMode);
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
        className={styles.iconButton}
        onClick={() => {
          if (trying) stopTry();
          else {
            const state = useCapture.getState();
            state.startRecordingIntoScene(state.currentSceneId);
          }
        }}
        aria-label={trying ? "Stop trying" : "Back to camera"}
      >
        <Icon name="back" size={24} />
      </button>
    </header>
  );
}
