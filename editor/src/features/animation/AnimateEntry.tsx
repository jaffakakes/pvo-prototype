import { useCapture } from "../../state/captureStore";
import { useAssistant } from "../../state/assistant/assistantStore";
import styles from "./AnimateEntry.module.css";

export function AnimateEntry({ music = false }: { music?: boolean }) {
  const busy = useAssistant(state => state.phase !== "idle");
  return <button type="button" className={styles.entry} disabled={busy} onClick={() => useCapture.getState().patch({
    sheet: "animation", playing: false, ...(music ? { sel: -1, selText: null, selComp: null, selAudio: null } : {}),
  })}>◆ Animate</button>;
}
