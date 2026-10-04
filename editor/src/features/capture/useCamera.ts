import { useCallback, useEffect, useRef, useState } from "react";
import { useCapture } from "../../state/captureStore";
import { whenLaunchSplashDismissed } from "../launch-splash/launchSplash";

type CameraStatus = "starting" | "switching" | "ready" | "unavailable";
type Facing = "user" | "environment";

let activeStream: MediaStream | null = null;

export const getCameraStream = () => useCapture.getState().camOn ? activeStream : null;

export function stopCam() {
  activeStream?.getTracks().forEach(track => track.stop());
  activeStream = null;
}

function releaseUnowned(streams: MediaStream[]) {
  const retained = new Set(activeStream?.getTracks() ?? []);
  for (const stream of streams) {
    for (const track of stream.getTracks()) {
      if (!retained.has(track)) track.stop();
    }
  }
}

function preferredVideoConstraints(facing: Facing): MediaTrackConstraints {
  // Preserve the camera's native shape; requesting the project ratio can make
  // browsers crop and upscale the sensor image before recording starts.
  return {
    facingMode: facing,
    width: { ideal: 1920 },
    frameRate: { ideal: 30 },
  };
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const freezeRef = useRef<HTMLCanvasElement>(null);
  const requestId = useRef(0);
  const bootTimer = useRef<number | null>(null);
  const abortFrameWait = useRef<(() => void) | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("starting");
  const [microphoneAvailable, setMicrophoneAvailable] = useState(false);
  const [freezeVisible, setFreezeVisible] = useState(false);
  const patch = useCapture(s => s.patch);

  const freezeCurrentFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = freezeRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
      setFreezeVisible(false);
      return;
    }

    // Keep the already-visible orientation. The stream must be released before
    // iOS can open the opposite camera, so the video element cannot stay live.
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setFreezeVisible(false);
      return;
    }
    try {
      if (useCapture.getState().facing === "user") {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      setFreezeVisible(true);
    } catch {
      setFreezeVisible(false);
    }
  }, []);

  const startCam = useCallback(async (requestedFacing?: Facing) => {
    if (bootTimer.current != null) {
      clearTimeout(bootTimer.current);
      bootTimer.current = null;
    }
    const id = ++requestId.current;
    abortFrameWait.current?.();
    const facing = requestedFacing ?? useCapture.getState().facing;
    const previous = activeStream;
    const hadAudio = !!previous?.getAudioTracks().length;
    const keptAudio = previous?.getAudioTracks().filter(track => track.readyState === "live") ?? [];
    const switching = previous != null;
    if (switching) freezeCurrentFrame();
    else setFreezeVisible(false);
    setCameraStatus(status => switching || status === "switching" ? "switching" : "starting");

    // iOS needs the old video track released before it can open the opposite camera.
    // Keep its microphone track alive so flipping does not reacquire audio permission.
    previous?.getVideoTracks().forEach(track => track.stop());
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    patch({ camOn: false });

    const fresh: MediaStream[] = [];
    let source: MediaStream | null = null;
    const videoOptions = [preferredVideoConstraints(facing), { facingMode: facing }];
    const audioOptions = switching ? [false] : [true, false];
    for (const withAudio of audioOptions) {
      for (const videoConstraints of videoOptions) {
        try {
          source = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: withAudio });
          fresh.push(source);
          break;
        } catch {
          if (id !== requestId.current) return;
        }
      }
      if (source) break;
    }

    if (id !== requestId.current) {
      releaseUnowned(fresh);
      return;
    }
    if (!source?.getVideoTracks().length) {
      stopCam();
      releaseUnowned(fresh);
      setFreezeVisible(false);
      setCameraStatus("unavailable");
      return;
    }

    let audio = keptAudio.filter(track => track.readyState === "live");
    if (switching && hadAudio && !audio.length) {
      try {
        const microphone = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        fresh.push(microphone);
        audio = microphone.getAudioTracks();
      } catch {
        // Video remains usable when the microphone is unavailable.
      }
    }
    if (id !== requestId.current) {
      releaseUnowned(fresh);
      return;
    }

    const stream = switching ? new MediaStream([...source.getVideoTracks(), ...audio]) : source;
    activeStream = stream;
    const liveVideo = videoRef.current;
    if (!liveVideo) {
      stopCam();
      releaseUnowned(fresh);
      setFreezeVisible(false);
      return;
    }
    liveVideo.muted = true;
    liveVideo.playsInline = true;
    liveVideo.srcObject = stream;

    const frameReady = await new Promise<boolean>(resolve => {
      let done = false;
      let playing = false;
      const finish = (ready: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        liveVideo.removeEventListener("loadeddata", check);
        liveVideo.removeEventListener("canplay", check);
        liveVideo.removeEventListener("error", failed);
        if (abortFrameWait.current === abort) abortFrameWait.current = null;
        resolve(ready);
      };
      const check = () => {
        if (playing && liveVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && liveVideo.videoWidth > 0) finish(true);
      };
      const failed = () => finish(false);
      const abort = () => finish(false);
      const timeout = window.setTimeout(failed, 12000);
      abortFrameWait.current = abort;
      liveVideo.addEventListener("loadeddata", check);
      liveVideo.addEventListener("canplay", check);
      liveVideo.addEventListener("error", failed);
      liveVideo.play().then(() => {
        playing = true;
        check();
      }, failed);
    });

    if (id !== requestId.current) {
      releaseUnowned(fresh);
      return;
    }
    if (!frameReady) {
      stopCam();
      liveVideo.pause();
      liveVideo.srcObject = null;
      releaseUnowned(fresh);
      setFreezeVisible(false);
      setCameraStatus("unavailable");
      return;
    }
    patch({ camOn: true });
    setMicrophoneAvailable(stream.getAudioTracks().some(track => track.readyState === "live"));
    setFreezeVisible(false);
    setCameraStatus("ready");
  }, [freezeCurrentFrame, patch]);

  useEffect(() => {
    // Deferring initial acquisition avoids StrictMode's setup/cleanup replay.
    let cancelled = false;
    bootTimer.current = window.setTimeout(() => {
      void whenLaunchSplashDismissed().then(() => {
        if (!cancelled) void startCam();
      });
    }, 0);
    return () => {
      cancelled = true;
      if (bootTimer.current != null) clearTimeout(bootTimer.current);
      bootTimer.current = null;
      requestId.current += 1;
      abortFrameWait.current?.();
      stopCam();
      if (freezeRef.current) {
        freezeRef.current.width = 0;
        freezeRef.current.height = 0;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
      patch({ camOn: false });
    };
  }, [startCam, patch]);

  return { videoRef, freezeRef, freezeVisible, startCam, cameraStatus, microphoneAvailable };
}
