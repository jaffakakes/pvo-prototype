import { useEffect, useRef, useState } from "react";
import { captureExportSnapshot } from "../../domain/publishing/exportSnapshot";
import { requireAccount } from "../../state/auth/authGateStore";
import { useCapture } from "../../state/captureStore";
import {
  beginExportAttempt,
  finishExportAttempt,
  useExportArtifact,
} from "../../state/export/exportArtifactStore";
import { clearNotificationScope, notify } from "../../state/notifications/notificationStore";
import {
  downloadCompletedExport,
  renderCompletedExport,
} from "./exportWorkflow";

export function useExportSession(format: "video" | "pvo") {
  const [failure, setFailure] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const exported = useExportArtifact();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearNotificationScope("export");
    };
  }, []);
  const start = async () => {
    if (!await requireAccount("export") || !mounted.current) return;
    const current = useCapture.getState();
    if (current.ex === "running") return;
    const snapshot = captureExportSnapshot(current, crypto.randomUUID());
    beginExportAttempt(snapshot.snapshotId);
    setFailure(null);
    clearNotificationScope("export");
    current.patch({ ex: "running", exPct: 0 });
    let completed;
    try {
      const progress = (fraction: number) => {
        if (useExportArtifact.getState().attempt === snapshot.snapshotId)
          useCapture.getState().patch({ exPct: Math.round(fraction * 100) });
      };
      completed = await renderCompletedExport(snapshot, format, progress);
    } catch (error) {
      if (useExportArtifact.getState().attempt !== snapshot.snapshotId) return;
      useExportArtifact.setState({ attempt: null });
      useCapture.getState().patch({ ex: "idle" });
      console.error("Could not export the current project:", error);
      if (mounted.current && useCapture.getState().sheet === "export") {
        setFailure(
          error instanceof Error
            ? error.message
            : "The file could not be generated.",
        );
        notify("exportFailed", { scope: "export", currentAttempt: true });
      }
      return;
    }
    if (!finishExportAttempt(completed.artifact, completed.url)) return;
    useCapture.getState().patch({
      ex: "done",
      exPct: 100,
      exUrl: completed.url,
      exName: completed.artifact.filename,
    });
    if (!await requireAccount("download") || !mounted.current) return;
    try {
      downloadCompletedExport(completed.url, completed.artifact.filename);
    } catch {
      if (mounted.current)
        setFailure("Download didn't start. Use Download again.");
    }
    if (mounted.current) setShowShare(true);
  };
  return { failure, showShare, setShowShare, exported, start };
}
