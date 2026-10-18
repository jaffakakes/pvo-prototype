import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import {
  captureMicrophone,
  type MicrophoneCapture,
} from "../../infrastructure/audio/microphoneCapture";
import { recordingDuration } from "../../infrastructure/audio/recordingDuration";
import {
  insertAudioClip,
  type AudioInsertionOwner,
} from "../../state/editing/audioCommands";
import { useCapture } from "../../state/captureStore";
import {
  notify,
  resolveNotification,
} from "../../state/notifications/notificationStore";

type Session = {
  controller: AbortController;
  owner: AudioInsertionOwner;
  capture?: MicrophoneCapture;
  started?: number;
};
type Draft = { blob: Blob; start: number; owner: AudioInsertionOwner };
// Failed recordings stay available when the user leaves the controls, until retry or discard.
function pauseOwnedPreview(owner: AudioInsertionOwner) {
  const state = useCapture.getState();
  if (
    state.localId === owner.localId &&
    state.currentSceneId === owner.currentSceneId
  )
    state.patch({ playing: false });
}

const useVoiceoverDraft = create<{ draft: Draft | null }>(() => ({
  draft: null,
}));

export function useVoiceover() {
  const draft = useVoiceoverDraft((state) => state.draft);
  const [phase, setPhase] = useState<
    "idle" | "permission" | "recording" | "saving"
  >("idle");
  const [noise, setNoise] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const active = useRef<Session | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (active.current) {
        active.current.controller.abort();
        pauseOwnedPreview(active.current.owner);
      }
    };
  }, []);

  async function save(retained: Draft) {
    const session = {
      controller: new AbortController(),
      owner: retained.owner,
    };
    active.current = session;
    setPhase("saving");
    let url: string | null = null;
    try {
      const duration = await recordingDuration(
        retained.blob,
        session.controller.signal,
      );
      url = URL.createObjectURL(retained.blob);
      if (
        !insertAudioClip(
          { name: "Voiceover", url, duration, start: retained.start },
          retained.owner,
        )
      )
        throw new Error(
          "The voiceover's project changed before it could be inserted.",
        );
      url = null;
      useVoiceoverDraft.setState({ draft: null });
      resolveNotification("voiceoverSaveFailed");
      // Keep the recorder available for another segment; Done returns to editing.
      useCapture.getState().patch({ sheet: "voiceover" });
    } catch (error) {
      if (!session.controller.signal.aborted) {
        console.error("[Voiceover] Could not insert recorded audio", error);
        notify("voiceoverSaveFailed");
      }
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (active.current === session) active.current = null;
      if (mounted.current) setPhase("idle");
    }
  }

  async function record() {
    if (active.current || draft) return;
    const initial = useCapture.getState();
    const owner: AudioInsertionOwner = {
      localId: initial.localId,
      currentSceneId: initial.currentSceneId,
      past: initial.past,
      future: initial.future,
    };
    const start = initial.t;
    const session: Session = { controller: new AbortController(), owner };
    active.current = session;
    setElapsed(0);
    setPhase("permission");
    const unsubscribe = useCapture.subscribe((state) => {
      if (
        state.localId !== owner.localId ||
        state.currentSceneId !== owner.currentSceneId ||
        state.past !== owner.past ||
        state.future !== owner.future ||
        state.screen !== "editor"
      )
        session.controller.abort();
    });
    const timer = window.setInterval(() => {
      if (session.started)
        setElapsed((performance.now() - session.started) / 1000);
    }, 100);
    try {
      pauseOwnedPreview(owner);
      session.capture = captureMicrophone(
        session.controller.signal,
        () => {
          session.started = performance.now();
          setPhase("recording");
          useCapture.getState().patch({ t: start, playing: true });
        },
        noise,
      );
      const blob = await session.capture.result;
      unsubscribe();
      pauseOwnedPreview(owner);
      session.controller.signal.throwIfAborted();
      const retained = { blob, start, owner };
      useVoiceoverDraft.setState({ draft: retained });
      await save(retained);
    } catch (error) {
      if (!session.controller.signal.aborted) {
        console.error("[Voiceover] Microphone capture failed", error);
        const name = error instanceof Error ? error.name : "";
        notify(
          ["NotAllowedError", "SecurityError"].includes(name)
            ? "voiceDenied"
            : [
                  "NotFoundError",
                  "NotReadableError",
                  "OverconstrainedError",
                ].includes(name)
              ? "voiceNoMicrophone"
              : name === "NotSupportedError"
                ? "voiceUnavailable"
                : "voiceFailed",
        );
      }
    } finally {
      unsubscribe();
      clearInterval(timer);
      if (active.current === session) {
        active.current = null;
        pauseOwnedPreview(owner);
      }
      if (mounted.current) setPhase("idle");
    }
  }
  return {
    phase,
    elapsed,
    noise,
    setNoise,
    record,
    stop: () => {
      setPhase("saving");
      active.current?.capture?.stop();
    },
    cancel: () => {
      active.current?.controller.abort();
    },
    draft,
    retry: () => {
      if (draft && !active.current) void save(draft);
    },
    discard: () => {
      useVoiceoverDraft.setState({ draft: null });
      resolveNotification("voiceoverSaveFailed");
    },
  };
}
