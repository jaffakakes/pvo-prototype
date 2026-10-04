import type { ExportFormat } from "../../domain/publishing/model";
import { requireAccount } from "../auth/authGateStore";
import { useCapture } from "../captureStore";

/** Header and settings use the same export entry command on every screen size. */
export async function requestExport(format?: ExportFormat) {
  const projectId = useCapture.getState().localId;
  if (!await requireAccount("export")) return;
  const current = useCapture.getState();
  if (current.localId !== projectId || current.screen !== "editor") return;
  useCapture.getState().patch({
    ...(format ? { exportFormat: format } : {}),
    sheet: "export",
    playing: false,
    orb: false,
  });
}
