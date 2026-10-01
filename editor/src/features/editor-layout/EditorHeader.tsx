import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { startTry, stopTry } from "../preview/tryMode";
import { DebugEntry } from "./debugging/DebugEntry";
import styles from "./EditorHeader.module.css";

export function EditorHeader() {
  const scenes = useCapture(state => state.scenes);
  const currentSceneId = useCapture(state => state.currentSceneId);
  const clips = useCapture(state => state.clips);
  const duration = useCapture(state => sceneDuration(state));
  const trying = useCapture(state => !!state.tryMode);
  const canUndo = useCapture(state => state.past.length > 0);
  const canRedo = useCapture(state => state.future.length > 0);
  const sceneName = scenes.find(scene => scene.id === currentSceneId)?.name ?? "Main";
  const sceneSummary = `${sceneName} · ${fmt(duration)} · ${clips.length ? `${clips.length} clip${clips.length === 1 ? "" : "s"}` : "no clips yet"}`;

  if (trying) return <header className={`editorHead ${styles.header}`}>
    <button className={styles.tryButton} onClick={stopTry}>Stop</button>
    <div className={styles.title}>
      <h1>Trying</h1>
      <p title={sceneSummary}>Tap like a viewer · {sceneName}</p>
    </div>
    <DebugEntry variant="mobile" />
  </header>;

  return <header className={`editorHead ${styles.header}`}>
    <button className={styles.iconButton} onClick={() => {
      const state = useCapture.getState();
      state.startRecordingIntoScene(state.currentSceneId);
    }} aria-label="Back to camera"><Icon name="back" size={19} /></button>
    <div className={styles.title}>
      <h1>Edit</h1>
      <p title={sceneSummary}>{sceneSummary}</p>
    </div>
    <button className={styles.iconButton} onClick={() => useCapture.getState().undo()} disabled={!canUndo} aria-label="Undo"><Icon name="undo" size={17} /></button>
    <button className={styles.iconButton} onClick={() => useCapture.getState().redo()} disabled={!canRedo} aria-label="Redo"><Icon name="redo" size={17} /></button>
    <button className={styles.tryButton} onClick={startTry} disabled={duration <= 0}>Try</button>
    <button className={styles.iconButton} onClick={() => useCapture.getState().patch({ sheet: "more", ratioMenu: false, playing: false, orb: false })} aria-label="More"><Icon name="more" size={20} /></button>
  </header>;
}
