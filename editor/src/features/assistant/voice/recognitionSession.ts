import { recognitionConstructor, recognitionFailure, type VoiceFailure } from "./browserRecognition";

export type VoicePhase = "idle" | "starting" | "listening" | "ready" | "finishing";
type Callbacks = {
  onPhase(phase: VoicePhase): void;
  onTranscript(text: string): void;
  onSend(text: string): void;
  onCancel(): void;
  onFailure(failure: VoiceFailure): void;
};

const START_TIMEOUT_MS = 10000;
const FINAL_TIMEOUT_MS = 5000;
const FINAL_RESULT_GRACE_MS = 150;

/** Owns one browser recognition attempt; only release can authorize sending. */
export function createRecognitionSession(callbacks: Callbacks, language: string,
  { startupTimeoutMs = START_TIMEOUT_MS, minimumWords = 2 }: { startupTimeoutMs?: number; minimumWords?: 1 | 2 } = {}) {
  const Recognition = recognitionConstructor();
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = language;

  let started = false;
  let ended = false;
  let released = false;
  let settled = false;
  let finalText = "";
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    clearTimeout(startTimer);
    clearTimeout(finishTimer);
  };
  const abort = () => {
    try { recognition.abort(); } catch { /* The browser may already have ended. */ }
  };
  const detach = (stop: boolean) => {
    clearTimers();
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onstart = null;
    recognition.onend = null;
    if (!stop || ended) return;
    // Permission can resolve after release/unmount. Keep only an abort guard
    // until the pending browser attempt ends; it never calls application code.
    recognition.onstart = abort;
    recognition.onend = () => {
      recognition.onstart = null;
      recognition.onend = null;
    };
    abort();
  };
  const cancel = (failure?: VoiceFailure) => {
    if (settled) return;
    settled = true;
    detach(true);
    callbacks.onPhase("idle");
    callbacks.onCancel();
    if (failure) callbacks.onFailure(failure);
  };
  const finish = () => {
    if (settled || !released) return;
    if (finalText.trim().split(/\s+/).filter(Boolean).length < minimumWords) {
      cancel(minimumWords === 1
        ? { reason: "noSpeech", detail: "No finalized speech was captured before Send." }
        : { reason: "holdShort", detail: "The hold ended before two words were captured." });
      return;
    }
    settled = true;
    detach(true);
    callbacks.onPhase("idle");
    callbacks.onSend(finalText.trim());
  };
  const finishAfterResults = () => {
    clearTimeout(finishTimer);
    finishTimer = setTimeout(finish, FINAL_RESULT_GRACE_MS);
  };

  recognition.onstart = () => {
    if (settled) { abort(); return; }
    started = true;
    clearTimeout(startTimer);
    callbacks.onPhase("listening");
  };
  recognition.onresult = event => {
    if (settled) return;
    const results = Array.from(event.results);
    finalText = results.filter(result => result.isFinal).map(result => result[0]?.transcript ?? "").join(" ").trim();
    callbacks.onTranscript(results.map(result => result[0]?.transcript ?? "").join(" ").trim());
    if (released && ended) finishAfterResults();
  };
  recognition.onerror = event => cancel(recognitionFailure(event.error));
  recognition.onend = () => {
    if (settled) return;
    ended = true;
    clearTimeout(startTimer);
    if (!started) {
      cancel({ reason: "failed", detail: "Speech recognition ended before microphone startup completed." });
      return;
    }
    if (released) finishAfterResults();
    else callbacks.onPhase("ready");
  };

  return {
    start() {
      if (settled) return;
      callbacks.onPhase("starting");
      callbacks.onTranscript("");
      startTimer = setTimeout(() => cancel({ reason: "failed", detail: "Microphone startup timed out." }), startupTimeoutMs);
      try { recognition.start(); }
      catch (error) { cancel(recognitionFailure(error instanceof Error ? error.name : "")); }
    },
    release() {
      if (settled || released) return;
      released = true;
      if (!started && !ended) {
        cancel({ reason: "holdShort", detail: "The hold ended before microphone startup completed." });
        return;
      }
      callbacks.onPhase("finishing");
      if (ended) { finishAfterResults(); return; }
      finishTimer = setTimeout(finish, FINAL_TIMEOUT_MS);
      try { recognition.stop(); }
      catch { cancel({ reason: "failed", detail: "Browser recognition.stop() failed." }); }
    },
    cancel: () => cancel(),
  };
}

export type RecognitionSession = NonNullable<ReturnType<typeof createRecognitionSession>>;
