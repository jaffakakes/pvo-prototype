import type { NativeBatch } from "../../domain/assistant/native/batch";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import { useCapture } from "../captureStore";
import { requestExport } from "../export/exportCommands";
import { projectSnapshot } from "../project/history";
import type { CaptureState } from "../types";
import { commitNativeBatch } from "./nativeCommands";
import { applyNativePlayback } from "./nativePlayback";

export type AppliedAssistantChange = {
  localId: CaptureState["localId"];
  past: CaptureState["past"];
  future: CaptureState["future"];
  fingerprint: string;
};

/** Apply the validated batch once, then execute its requested editor effects. */
export function applyAssistantChanges(batch: NativeBatch): AppliedAssistantChange | null {
  const changed = commitNativeBatch(batch, nativeProjectFingerprint(batch.before), "edit");
  applyNativePlayback(batch.playback);
  if (batch.exportFormat) void requestExport(batch.exportFormat);
  if (!changed) return null;
  const current = useCapture.getState();
  return { localId: current.localId, past: current.past, future: current.future,
    fingerprint: nativeProjectFingerprint(projectSnapshot(current)) };
}
