import type { ExportFormat } from "../../domain/publishing/model";
import { useCapture } from "../captureStore";

/** Header and settings use the same export entry command on every screen size. */
export function requestExport(format?: ExportFormat) {
  useCapture.getState().patch({
    ...(format ? { exportFormat: format } : {}),
    sheet: "export",
    playing: false,
    orb: false,
  });
}
