import { useCapture } from "../captureStore";

/** All export entry points use the same command. */
export function requestExport() {
  const current = useCapture.getState();
  if (current.screen !== "editor") return;
  useCapture.getState().patch({
    sheet: "export",
    playing: false,
    orb: false,
  });
}
