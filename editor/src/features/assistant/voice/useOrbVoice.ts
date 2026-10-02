import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { recognitionConstructor, type VoiceFailure } from "./browserRecognition";
import { createRecognitionSession, type RecognitionSession, type VoicePhase } from "./recognitionSession";

type Options = {
  enabled?: boolean;
  onTap(): void;
  onListening(transcript: string): void;
  onSend(text: string): void;
  onCancel(): void;
  onFailure(failure: VoiceFailure): void;
};
type Press = {
  time: number;
  button: HTMLButtonElement;
  pointerId?: number;
  key?: string;
  held: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

const HOLD_DELAY_MS = 320;
export type VoiceMode = "hold" | "tap";

/** Maps a button tap/hold to typing or a single, cancellable voice request. */
export function useOrbVoice(options: Options) {
  const current = useRef(options);
  current.current = options;
  const mounted = useRef(false);
  const press = useRef<Press | null>(null);
  const session = useRef<RecognitionSession | null>(null);
  const sessionMode = useRef<VoiceMode>("hold");
  const sessionPhase = useRef<VoicePhase>("idle");
  const tapAction = useRef<"cancel" | "send" | null>(null);
  const suppressClickUntil = useRef(0);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [isPressed, setPressed] = useState(false);

  const clearPress = useCallback(() => {
    const active = press.current;
    press.current = null;
    if (mounted.current) setPressed(false);
    if (!active) return null;
    clearTimeout(active.timer);
    if (active.pointerId !== undefined && active.button.hasPointerCapture(active.pointerId)) {
      active.button.releasePointerCapture(active.pointerId);
    }
    return active;
  }, []);

  const cancel = useCallback(() => {
    tapAction.current = null;
    const active = clearPress();
    if (session.current) session.current.cancel();
    else if (active && mounted.current) current.current.onCancel();
  }, [clearPress]);

  const startVoice = (mode: VoiceMode) => {
    if (current.current.enabled === false || session.current) return;
    tapAction.current = null;
    sessionMode.current = mode;
    let voice: RecognitionSession | null;
    try {
      voice = createRecognitionSession({
        onPhase: value => {
          sessionPhase.current = value;
          if (mounted.current) setPhase(value);
        },
        onTranscript: text => { if (mounted.current) current.current.onListening(text); },
        onSend: text => {
          session.current = null;
          if (mounted.current) current.current.onSend(text);
        },
        onCancel: () => {
          session.current = null;
          if (mounted.current) current.current.onCancel();
        },
        onFailure: failure => { if (mounted.current) current.current.onFailure(failure); },
      }, navigator.language || "en", {
        startupTimeoutMs: mode === "tap" ? 30000 : 10000,
        minimumWords: mode === "tap" ? 1 : 2,
      });
    } catch {
      current.current.onCancel();
      current.current.onFailure({ reason: "failed", detail: "Browser recognition could not be constructed." });
      return;
    }
    if (!voice) {
      current.current.onCancel();
      current.current.onTap();
      current.current.onFailure({ reason: "unavailable", detail: "The browser has no speech recognition API." });
      return;
    }
    session.current = voice;
    voice.start();
  };

  const beginVoice = () => {
    if (!press.current) return;
    press.current.held = true;
    startVoice("hold");
  };
  const start = () => {
    if (!press.current) startVoice("tap");
  };
  const currentTapAction = () => sessionPhase.current === "starting" ? "cancel" : "send";
  const finishTap = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    // Permission can finish between pressing Cancel and releasing it. Preserve
    // the action the user chose before the button changes to Send.
    const action = tapAction.current ?? currentTapAction();
    tapAction.current = null;
    if (action === "cancel") cancel();
    else session.current?.release();
  };

  const begin = (button: HTMLButtonElement, input: { pointerId?: number; key?: string }) => {
    if (current.current.enabled === false || press.current || session.current) return;
    const active: Press = { time: performance.now(), button, ...input, held: false };
    press.current = active;
    setPressed(true);
    active.timer = setTimeout(beginVoice, HOLD_DELAY_MS);
  };
  const release = () => {
    const active = clearPress();
    if (!active) return;
    suppressClickUntil.current = performance.now() + 400;
    if (active.held) { session.current?.release(); return; }
    if (current.current.enabled === false) return;
    if (performance.now() - active.time < HOLD_DELAY_MS) current.current.onTap();
    else current.current.onFailure({ reason: "holdShort", detail: "The orb was released before the voice hold threshold." });
  };

  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden) cancel(); };
    const blurred = () => {
      // A permission dialog can take focus. A tapped microphone does not
      // depend on a held pointer, so let this explicit startup finish.
      if (sessionMode.current === "tap" && sessionPhase.current === "starting") return;
      cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", blurred);
    window.addEventListener("pagehide", cancel);
    return () => {
      mounted.current = false;
      cancel();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", blurred);
      window.removeEventListener("pagehide", cancel);
    };
  }, [cancel]);
  useEffect(() => { if (options.enabled === false) cancel(); }, [options.enabled, cancel]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || current.current.enabled === false) return;
    event.preventDefault();
    begin(event.currentTarget, { pointerId: event.pointerId });
    if (press.current?.pointerId === event.pointerId) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (press.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    release();
  };
  const cancelPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (press.current?.pointerId === event.pointerId) cancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && (press.current || session.current)) {
      event.preventDefault(); event.stopPropagation(); cancel(); return;
    }
    if (![" ", "Enter"].includes(event.key) || current.current.enabled === false) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) begin(event.currentTarget, { key: event.key });
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (press.current?.key !== event.key) return;
    event.preventDefault(); event.stopPropagation(); release();
  };

  return {
    phase, mode: sessionMode.current, voiceActive: phase !== "idle", isPressed,
    supported: recognitionConstructor() !== null,
    cancel, start,
    tapHandlers: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.isPrimary && event.button === 0) tapAction.current = currentTapAction();
      },
      onPointerCancel: () => { tapAction.current = null; },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if ([" ", "Enter"].includes(event.key) && !event.repeat) tapAction.current = currentTapAction();
      },
      onBlur: () => { tapAction.current = null; },
      onClick: finishTap,
    },
    handlers: {
      onPointerDown, onPointerUp, onPointerCancel: cancelPointer, onLostPointerCapture: cancelPointer,
      onKeyDown, onKeyUp,
      onBlur: () => { if (press.current?.key) cancel(); },
      onContextMenu: (event: MouseEvent<HTMLButtonElement>) => event.preventDefault(),
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        if (event.detail === 0 && performance.now() >= suppressClickUntil.current
          && current.current.enabled !== false && !press.current && !session.current) current.current.onTap();
      },
    },
  };
}
