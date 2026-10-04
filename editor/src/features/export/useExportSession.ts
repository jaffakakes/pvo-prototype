import { useEffect, useRef, useState } from "react";
import { captureExportSnapshot } from "../../domain/publishing/exportSnapshot";
import { exportFilename } from "../../domain/export/filename";
import type { ExportSnapshot, ExportStage } from "../../domain/publishing/model";
import { requireAccount } from "../../state/auth/authGateStore";
import { useCapture } from "../../state/captureStore";
import {
  beginExportAttempt,
  cancelExportAttempt,
  discardExportAttempt,
  finishExportAttempt,
  setExportRenderStage,
  useExportArtifact,
} from "../../state/export/exportArtifactStore";
import { clearNotificationScope, notify } from "../../state/notifications/notificationStore";
import { renderCompletedExport } from "./exportWorkflow";

type PosterProvider = (snapshot: ExportSnapshot, signal: AbortSignal) => Promise<Blob | null>;

export function useExportSession(format: "video" | "pvo") {
  const [failure, setFailure] = useState<string | null>(null);
  const [failureStage, setFailureStage] = useState<ExportStage | null>(null);
  const [showShare, setShowShare] = useState(false);
  const exported = useExportArtifact();
  const mounted = useRef(true);
  const ownedAttempt = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (ownedAttempt.current && cancelExportAttempt(ownedAttempt.current))
        useCapture.getState().patch({ ex: "idle", exPct: 0 });
      clearNotificationScope("export");
    };
  }, []);
  const start = async (posterProvider?: PosterProvider) => {
    if (!await requireAccount("export") || !mounted.current) return;
    const current = useCapture.getState();
    if (current.ex === "running") return;
    const snapshot = captureExportSnapshot(current, crypto.randomUUID());
    const filename = current.projectName;
    const controller = new AbortController();
    ownedAttempt.current = snapshot.snapshotId;
    beginExportAttempt(snapshot.snapshotId, controller);
    setFailure(null);
    setFailureStage(null);
    clearNotificationScope("export");
    current.patch({ ex: "running", exPct: 0 });
    let completed;
    try {
      const poster = await posterProvider?.(snapshot, controller.signal) ?? null;
      controller.signal.throwIfAborted();
      const progress = (fraction: number) => {
        if (useExportArtifact.getState().attempt === snapshot.snapshotId)
          useCapture.getState().patch({ exPct: Math.round(fraction * 100) });
      };
      completed = await renderCompletedExport(snapshot, format, progress, undefined, {
        signal: controller.signal,
        stage: (value) => setExportRenderStage(snapshot.snapshotId, value),
        poster,
      });
    } catch (error) {
      ownedAttempt.current = null;
      if (useExportArtifact.getState().attempt !== snapshot.snapshotId) return;
      setFailureStage(useExportArtifact.getState().renderStage);
      discardExportAttempt(snapshot.snapshotId);
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
    ownedAttempt.current = null;
    const artifact = { ...completed.artifact,
      filename: exportFilename(filename, completed.artifact.filename) };
    if (!finishExportAttempt(artifact, completed.url)) return;
    useCapture.getState().patch({
      ex: "done",
      exPct: 100,
      exUrl: completed.url,
      exName: artifact.filename,
    });
  };
  const cancel = () => {
    if (!cancelExportAttempt()) return;
    ownedAttempt.current = null;
    useCapture.getState().patch({ ex: "idle", exPct: 0 });
    setFailure(null);
    setFailureStage(null);
  };
  return { failure, failureStage, showShare, setShowShare, exported, start, cancel };
}
