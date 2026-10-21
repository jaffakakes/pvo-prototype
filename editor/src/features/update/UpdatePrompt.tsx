import { useEffect, useState, useSyncExternalStore } from "react";
import { saveProjectBeforeUpdate } from "../../app/projectAutosave";
import {
  activateEditorUpdate,
  getEditorUpdateState,
  subscribeEditorUpdates,
} from "../../infrastructure/pwa/registerServiceWorker";
import { useCapture } from "../../state/captureStore";
import { useAssistant } from "../../state/assistant/assistantStore";
import { BottomNotice } from "../../ui/BottomNotice";
import { useNotifications } from "../../state/notifications/notificationStore";

function updateBlocked(): boolean {
  const state = useCapture.getState();
  return state.recording || state.importing || state.countdown > 0
    || state.ex === "running" || state.sheet !== null || useAssistant.getState().phase !== "idle";
}

export function UpdatePrompt() {
  const storageIssue = useNotifications(state => state.unresolved.some(issue => issue.id === "saveFailed" || issue.id === "restoreFailed"));
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

  if ((!update.available && !update.applying) || busy || assistantBusy || dismissed || storageIssue) return null;

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

  return <BottomNotice message={label} action={action}
    actionLabel={action === "Retry" ? "Retry update" : "Update"}
    disabled={saving || update.applying} onAction={() => { void startUpdate(); }}
    dismissLabel="Dismiss update notice" onDismiss={!saving && !update.applying ? () => setDismissed(true) : undefined} />;
}
