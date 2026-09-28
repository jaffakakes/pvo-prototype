import { useEffect, useState, useSyncExternalStore } from "react";
import { saveProjectBeforeUpdate } from "../../app/projectAutosave";
import {
  activateEditorUpdate,
  getEditorUpdateState,
  subscribeEditorUpdates,
} from "../../infrastructure/pwa/registerServiceWorker";
import { useCapture } from "../../state/captureStore";
import { useAssistant } from "../../state/assistant/assistantStore";
import styles from "./UpdatePrompt.module.css";

function updateBlocked(): boolean {
  const state = useCapture.getState();
  return state.recording || state.importing || state.countdown > 0
    || state.ex === "running" || state.sheet !== null || useAssistant.getState().phase !== "idle";
}

export function UpdatePrompt() {
  const update = useSyncExternalStore(
    subscribeEditorUpdates,
    getEditorUpdateState,
    getEditorUpdateState,
  );
  const busy = useCapture(state => state.recording || state.importing
    || state.countdown > 0 || state.ex === "running" || state.sheet !== null);
  const [saving, setSaving] = useState(false);
  const assistantBusy = useAssistant(state => state.phase !== "idle");
  const [saveFailed, setSaveFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setDismissed(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if ((!update.available && !update.applying) || busy || assistantBusy || dismissed) return null;

  const startUpdate = async () => {
    if (saving || update.applying) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await saveProjectBeforeUpdate();
      // A recording can begin while a large video is being saved.
      if (!updateBlocked()) activateEditorUpdate();
    } catch (error) {
      console.error("Restyle could not save this project before updating:", error);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const label = update.applying ? "Installing beta…"
    : saving ? "Saving your project…"
      : saveFailed ? "Couldn't save project"
        : update.error ? "Update failed" : "New beta release";
  const action = update.applying || saving ? "Wait"
    : saveFailed || update.error ? "Retry" : "Update";

  return (
    <div className={styles.position}>
      <div className={styles.notice} role="status" aria-live="polite">
        <button
          className={styles.update}
          type="button"
          aria-label={action === "Retry" ? "Retry update" : "Update"}
          disabled={saving || update.applying}
          onClick={() => { void startUpdate(); }}
        >
          <img src="restyle-mark.png" alt="" />
          <span>{label}</span>
          <strong>{action}</strong>
        </button>
        {!saving && !update.applying && (
          <button
            className={styles.dismiss}
            type="button"
            aria-label="Dismiss update notice"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
