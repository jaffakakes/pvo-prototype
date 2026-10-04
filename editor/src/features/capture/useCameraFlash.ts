import { useCallback, useEffect, useMemo, useState } from "react";
import { useCapture } from "../../state/captureStore";
import {
  clearNotificationScope,
  notify,
} from "../../state/notifications/notificationStore";
import { cameraFlashMode, setCameraTorch } from "./cameraFlash";

export function useCameraFlash(
  track: MediaStreamTrack | null,
  capturing: boolean,
  requestedFacing: "user" | "environment",
  releaseCamera: (track: MediaStreamTrack) => void,
) {
  const armed = useCapture((state) => state.flash);
  const [unavailableTrack, setUnavailableTrack] =
    useState<MediaStreamTrack | null>(null);
  const mode = useMemo(
    () => cameraFlashMode(track, requestedFacing),
    [track, requestedFacing],
  );
  const flashAvailable =
    track !== null &&
    track.readyState === "live" &&
    unavailableTrack !== track &&
    mode !== null;

  useEffect(() => {
    if (!track) return;
    const scope = `camera-flash:${track.id}`;
    const ended = () => setUnavailableTrack(track);
    track.addEventListener("ended", ended);
    return () => {
      track.removeEventListener("ended", ended);
      clearNotificationScope(scope);
    };
  }, [track]);

  useEffect(() => {
    if (!track || mode !== "torch" || !flashAvailable) return;
    let current = true;
    const enabled = armed && capturing;
    void setCameraTorch(track, enabled, releaseCamera).catch(
      (error: unknown) => {
        if (!current) return;
        console.warn(
          "Camera flash could not apply its recording state.",
          error,
        );
        if (track.readyState !== "live") return;
        setUnavailableTrack(track);
        if (enabled) {
          useCapture.getState().patch({ flash: false });
          notify("flashUnavailable", {
            scope: `camera-flash:${track.id}`,
            currentAttempt: true,
          });
        }
      },
    );
    return () => {
      current = false;
      // Stop, flip, and unmount must follow any pending activation with off.
      void setCameraTorch(track, false, releaseCamera).catch(
        (error: unknown) => {
          console.warn(
            "Camera flash cleanup could not turn the torch off.",
            error,
          );
        },
      );
    };
  }, [track, mode, armed, capturing, flashAvailable, releaseCamera]);

  const toggleFlash = useCallback(() => {
    if (!flashAvailable) return;
    const state = useCapture.getState();
    state.patch({ flash: !state.flash });
  }, [flashAvailable]);

  return {
    flashAvailable,
    screenFlash: flashAvailable && mode === "screen" && armed && capturing,
    toggleFlash,
  };
}
