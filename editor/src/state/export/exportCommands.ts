import { useCapture } from "../captureStore";

/** Header and settings use the same export entry command on every screen size. */
export function requestExport() {
  const current = useCapture.getState();
  if (current.screen !== "editor") return;
  useCapture.getState().patch({
    exportFormat: "pvo",
    sheet: "export",
    playing: false,
    orb: false,
  });
}
