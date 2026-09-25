import { useCallback, useEffect, useRef } from "react";
import { useCapture } from "../store";

let activeStream: MediaStream | null = null;
export const getCameraStream = () => activeStream;
export function stopCam() {
  activeStream?.getTracks().forEach(track => track.stop());
  activeStream = null;
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const facing = useCapture(s => s.facing);
  const camOn = useCapture(s => s.camOn);
  const patch = useCapture(s => s.patch);
  const startCam = useCallback(async () => {
    stopCam();
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: true });
    } catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false }); }
      catch { stream = null; }
    }
    activeStream = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      videoRef.current.play().catch(() => {});
    }
    patch({ camOn: !!stream });
  }, [facing, patch]);

  useEffect(() => {
    if (!videoRef.current || !activeStream) return;
    videoRef.current.srcObject = activeStream;
    videoRef.current.play().catch(() => {});
  }, [camOn]);

  useEffect(() => { startCam(); return () => { stopCam(); patch({ camOn: false }); }; }, [startCam, patch]);
  return { videoRef, startCam };
}
