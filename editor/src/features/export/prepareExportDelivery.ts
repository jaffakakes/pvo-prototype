import { recordExportConnections } from "../services/exportConnections";
import type { CompletedExport } from "../../domain/publishing/model";
import { exportActivationAdapters } from "../../infrastructure/services/exportActivation";
import { useAuthGate } from "../../state/auth/authGateStore";
import { useCapture } from "../../state/captureStore";
import { useExportArtifact } from "../../state/export/exportArtifactStore";
import { activateExportServices } from "./activateExportServices";

/** Host wiring; all file/link entry points use the same activation rules and frozen artifact. */
export async function prepareExportDelivery(
  artifact: CompletedExport,
  signal: AbortSignal,
) {
  const accountId = useAuthGate.getState().user?.id;
  const localId = useCapture.getState().localId;
  const context = {
    signal,
    isCurrent: () => {
      const current = useExportArtifact.getState();
      const scope = artifact.services;
      return (
        !!accountId &&
        accountId === useAuthGate.getState().user?.id &&
        localId === useCapture.getState().localId &&
        (current.artifact === artifact ||
          current.prepared?.artifact === artifact) &&
        (!scope ||
          (scope.ownerId === accountId &&
            scope.localId === localId &&
            scope.origin === window.location.origin))
      );
    },
  };
  await activateExportServices(
    artifact.services,
    exportActivationAdapters,
    context,
  );
  await recordExportConnections(artifact, signal, () => {
    signal.throwIfAborted();
    if (!context.isCurrent())
      throw new DOMException(
        "Export account or project changed.",
        "AbortError",
      );
  });
}
