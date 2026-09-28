import { useEffect, useRef, useState } from "react";
import { useCapture } from "../../state/captureStore";
import { clearNotificationScope, notify } from "../../state/notifications/notificationStore";
import { getCameraStream, type useCamera } from "./useCamera";

export function useCameraControls(
  cameraStatus: ReturnType<typeof useCamera>["cameraStatus"],
  startCam: ReturnType<typeof useCamera>["startCam"],
) {
  const s = useCapture();
  const [flashUnavailable, setFlashUnavailable] = useState(false);
  const flashTrack = useRef<string | null>(null);
  const displayCameraStatus =
    cameraStatus === "ready" && !s.camOn ? "switching" : cameraStatus;
  const cameraPending =
    displayCameraStatus === "starting" || displayCameraStatus === "switching";
  useEffect(() => {
    const trackId = getCameraStream()?.getVideoTracks()[0]?.id ?? null;
    if (trackId !== flashTrack.current) {
      flashTrack.current = trackId;
      setFlashUnavailable(false);
      clearNotificationScope("camera-flash");
    }
    return () => {
      clearNotificationScope("camera-flash");
    };
  }, [cameraStatus, s.facing]);
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

  const toggleFlash = async () => {
    if (flashUnavailable || cameraPending) return;
    const next = !s.flash;
    const track = getCameraStream()?.getVideoTracks()[0];
    try {
      if (!track) throw new Error("No camera track");
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      if (getCameraStream()?.getVideoTracks()[0] !== track) return;
      s.patch({ flash: next });
    } catch {
      if (track && getCameraStream()?.getVideoTracks()[0] !== track) return;
      setFlashUnavailable(true);
      notify("flashUnavailable", {
        scope: "camera-flash",
        currentAttempt: true,
      });
    }
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
    flashUnavailable,
    displayCameraStatus,
    cameraPending,
    removeLast,
    flip,
    toggleFlash,
    startOver,
  };
}
