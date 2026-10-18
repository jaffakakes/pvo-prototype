export const MAX_MICROPHONE_SECONDS = 60;
const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
const STOP_TIMEOUT_MS = 5000;

export type MicrophoneCapture = { result: Promise<Blob>; stop(): void };

export function microphoneSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
    && typeof MediaRecorder !== "undefined" && typeof OfflineAudioContext !== "undefined";
}

/** Owns one microphone stream, including permission that resolves after cancellation. */
export function captureMicrophone(signal: AbortSignal, onStarted: () => void): MicrophoneCapture {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let settled = false;
  let stopping = false;
  let size = 0;
  let chunks: Blob[] = [];
  let limitTimer: ReturnType<typeof setTimeout> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (audio: Blob) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<Blob>((done, fail) => { resolve = done; reject = fail; });

  const cleanup = () => {
    clearTimeout(limitTimer);
    clearTimeout(stopTimer);
    signal.removeEventListener("abort", cancel);
    if (recorder) {
      recorder.onstart = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* Tracks are stopped below even if the recorder fails. */ }
      }
    }
    for (const track of stream?.getTracks() ?? []) {
      track.removeEventListener("ended", interrupted);
      track.stop();
    }
    stream = null;
    chunks = [];
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };
  const cancel = () => fail(signal.reason ?? new DOMException("Voice input cancelled.", "AbortError"));
  const interrupted = () => fail(new DOMException("The microphone disconnected.", "NotReadableError"));
  const stop = () => {
    if (settled || stopping) return;
    stopping = true;
    clearTimeout(limitTimer);
    stopTimer = setTimeout(() => fail(new Error("Microphone recording did not finish.")), STOP_TIMEOUT_MS);
    try { recorder?.stop(); }
    catch (error) { fail(error); }
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  else if (!microphoneSupported()) fail(new DOMException("Microphone recording is unavailable.", "NotSupportedError"));
  else {
    // Only microphone permission is needed; no speech service or Siri permission is involved.
    let access: Promise<MediaStream>;
    try {
      access = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    } catch (error) {
      fail(error);
      return { result, stop };
    }
    void access.then(acquired => {
        if (settled || signal.aborted) {
          acquired.getTracks().forEach(track => track.stop());
          return;
        }
        stream = acquired;
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks.length || audioTracks.every(track => track.readyState === "ended")) {
          fail(new DOMException("No microphone is available.", "NotFoundError"));
          return;
        }
        for (const track of audioTracks) track.addEventListener("ended", interrupted, { once: true });
        try {
          // Let the browser select its supported recording container (Safari uses MP4).
          recorder = new MediaRecorder(stream, { audioBitsPerSecond: 128000 });
          recorder.onstart = () => {
            if (settled || stopping) return;
            limitTimer = setTimeout(stop, MAX_MICROPHONE_SECONDS * 1000);
            onStarted();
          };
          recorder.ondataavailable = event => {
            if (settled || !event.data.size) return;
            size += event.data.size;
            if (size > MAX_RECORDING_BYTES) { fail(new Error("Microphone recording exceeded its size limit.")); return; }
            chunks.push(event.data);
          };
          recorder.onerror = () => fail(new Error("Microphone recording failed."));
          recorder.onstop = () => {
            if (settled) return;
            const audio = new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type });
            settled = true;
            cleanup();
            resolve(audio);
          };
          recorder.start(250);
        } catch (error) { fail(error); }
      }, fail);
  }
  return { result, stop };
}
