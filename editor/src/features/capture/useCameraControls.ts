import { useCapture } from "../../state/captureStore";
import type { useCamera } from "./useCamera";

export function useCameraControls(
  cameraStatus: ReturnType<typeof useCamera>["cameraStatus"],
  startCam: ReturnType<typeof useCamera>["startCam"],
) {
  const s = useCapture();
  const displayCameraStatus =
    cameraStatus === "ready" && !s.camOn ? "switching" : cameraStatus;
  const cameraPending =
    displayCameraStatus === "starting" || displayCameraStatus === "switching";
  const removeLast = () => {
    if (!s.clips.length) return;
    s.edit({ clips: s.clips.slice(0, -1) });
  };

  const flip = () => {
    if (s.recording || cameraPending) return;
    const next = s.facing === "user" ? "environment" : "user";
    // Capture the current, correctly mirrored frame before changing facing.
    void startCam(next);
    s.patch({ facing: next });
  };

  const startOver = () => {
    if (s.recording) return;
    if (s.recordingInto) {
      s.cancelRecordingIntoScene();
      return;
    }
    if (s.replacing != null) {
      s.patch({ replacing: null, screen: "editor" });
      return;
    }
    if (s.clips.length) s.patch({ sheet: "discard" });
  };

  return {
    displayCameraStatus,
    cameraPending,
    removeLast,
    flip,
    startOver,
  };
}
