import { captureMicrophone, type MicrophoneCapture } from "../../../infrastructure/assistant/microphoneCapture";
import { requireMicrophoneTranscription, transcribeMicrophone } from "../../../infrastructure/assistant/microphoneTranscription";
import { voiceFailure, type VoiceFailure } from "./voiceFailure";

export type VoicePhase = "idle" | "starting" | "listening" | "ready" | "transcribing";
type Callbacks = {
  onPhase(phase: VoicePhase): void;
  onTranscript(text: string): void;
  onSend(text: string): void;
  onCancel(): void;
  onFailure(failure: VoiceFailure): void;
};
type Options = {
  startupTimeoutMs?: number;
  minimumWords?: 1 | 2;
  capture?: typeof captureMicrophone;
  transcribe?: typeof transcribeMicrophone;
  available?: typeof requireMicrophoneTranscription;
};

/** Recording completion alone never authorizes uploading or submitting a request. */
export function createVoiceSession(callbacks: Callbacks, {
  startupTimeoutMs = 30000, minimumWords = 2,
  capture = captureMicrophone, transcribe = transcribeMicrophone,
  available = requireMicrophoneTranscription,
}: Options = {}) {
  const controller = new AbortController();
  let microphone: MicrophoneCapture | null = null;
  let audio: Blob | null = null;
  let started = false;
  let requested = false;
  let released = false;
  let settled = false;
  let uploading = false;
  let startTimer: ReturnType<typeof setTimeout> | undefined;

  const cancel = (failure?: VoiceFailure) => {
    if (settled) return;
    settled = true;
    clearTimeout(startTimer);
    controller.abort();
    audio = null;
    callbacks.onPhase("idle");
    callbacks.onCancel();
    if (failure) callbacks.onFailure(failure);
  };
  const submit = async () => {
    if (settled || uploading || !released || !audio) return;
    uploading = true;
    try {
      const text = await transcribe(audio, controller.signal);
      controller.signal.throwIfAborted();
      if (settled) return;
      if (text.trim().split(/\s+/).filter(Boolean).length < minimumWords) {
        cancel(!text.trim() || minimumWords === 1
          ? { reason: "noSpeech", detail: "No speech was captured in the microphone recording." }
          : { reason: "holdShort", detail: "The hold captured fewer than two words." });
        return;
      }
      settled = true;
      audio = null;
      callbacks.onPhase("idle");
      callbacks.onTranscript(text);
      callbacks.onSend(text);
    } catch (error) {
      if (!settled) cancel(voiceFailure(error));
    }
  };

  return {
    start() {
      if (settled || requested) return;
      requested = true;
      callbacks.onPhase("starting");
      callbacks.onTranscript("");
      startTimer = setTimeout(() => cancel({ reason: "failed", detail: "Microphone startup timed out." }), startupTimeoutMs);
      void available(controller.signal).then(() => {
        if (settled || controller.signal.aborted) return;
        microphone = capture(controller.signal, () => {
          if (settled) return;
          started = true;
          clearTimeout(startTimer);
          callbacks.onPhase("listening");
        });
        void microphone.result.then(recorded => {
          if (settled) return;
          clearTimeout(startTimer);
          audio = recorded;
          if (released) void submit();
          else callbacks.onPhase("ready");
        }, error => { if (!settled) cancel(voiceFailure(error)); });
      }).catch(error => { if (!settled) cancel(voiceFailure(error)); });
    },
    release() {
      if (settled || released) return;
      if (!started) { cancel({ reason: "holdShort", detail: "The hold ended before microphone startup completed." }); return; }
      released = true;
      callbacks.onPhase("transcribing");
      microphone?.stop();
      void submit();
    },
    cancel: () => cancel(),
  };
}

export type VoiceSession = ReturnType<typeof createVoiceSession>;
