import { useEffect, useRef, useState } from "react";
import type { AnimationTarget } from "../../domain/animation/model";
import { duckAudioUnderSpeech } from "../../state/animation/ducking";
import { useCapture } from "../../state/captureStore";

/** The audio sheet owns its request; switching layers or closing it cancels analysis. */
export function useAudioDucking(target: AnimationTarget) {
  const sceneId = useCapture(state => state.currentSceneId);
  const projectId = useCapture(state => state.localId);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = "id" in target ? target.id : null;
  useEffect(() => {
    setBusy(false);
    setError(null);
    return () => { request.current?.abort(); request.current = null; };
  }, [sceneId, projectId, target.kind, id]);
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setError(null);
  };
  const run = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      await duckAudioUnderSpeech(target, { signal: controller.signal });
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : "Speech analysis could not complete.");
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  return { run, cancel, busy, error };
}
