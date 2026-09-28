export type RecognitionResult = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
};

export type BrowserRecognition = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionConstructor = new () => BrowserRecognition;
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

export function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browser = window as SpeechWindow;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

export type VoiceFailure = {
  reason: "holdShort" | "unavailable" | "denied" | "noMicrophone" | "noSpeech" | "network" | "failed";
  detail: string;
};

export function recognitionFailure(error: string): VoiceFailure {
  if (["not-allowed", "service-not-allowed", "NotAllowedError", "SecurityError"].includes(error))
    return { reason: "denied", detail: error };
  if (error === "audio-capture") return { reason: "noMicrophone", detail: error };
  if (error === "no-speech") return { reason: "noSpeech", detail: error };
  if (error === "network") return { reason: "network", detail: error };
  return { reason: "failed", detail: error || "Unknown browser recognition failure." };
}
