import { useEffect, useRef, useState } from "react";
import type { NativeTrackingTarget, NativeVisualAnimationTarget } from "../../../../packages/pvo-assistant/native/index.js";
import type { AnimationTarget } from "../../domain/animation/model";
import { getLayerTracking, type TrackingStep } from "../../domain/animation/trackingMetadata";
import { defaultTrackingRange, validateTrackingRange, type TrackingRange } from "../../domain/animation/trackingRange";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import { captureTrackingFrame } from "../../infrastructure/assistant/media/trackingFrames";
import { trackAssistantObject } from "../../infrastructure/assistant/media/objectTracking";
import { useCapture } from "../../state/captureStore";
import { projectSnapshot } from "../../state/project/history";
import { scrubPlayback } from "../../state/editing/playbackCommands";
import { commitTrackedAnimation } from "../../state/editing/trackingCommands";
import { notifyAssistantApplied } from "../../state/assistant/nativeAppliedNotification";

type Prepared = { snapshot: ReturnType<typeof projectSnapshot>; fingerprint: string; sceneId: string; range: TrackingRange };
type PickFrame = { dataUrl: string; width: number; height: number; prepared: Prepared };

/** Picking, re-tracking and typed AI requests ultimately use the same measured tracking rule. */
export function useLayerFollowing(target: AnimationTarget) {
  const visualTarget: NativeVisualAnimationTarget | null = target.kind === "component" ? target : target.kind === "clip" || target.kind === "text" ? { kind: target.kind, id: target.id } : null;
  const scene = useCapture(state => state.scenes.find(item => item.id === state.currentSceneId));
  const tracking = scene ? getLayerTracking(scene, target) : null;
  const job = useRef<AbortController | null>(null);
  const [frame, setFrame] = useState<PickFrame | null>(null);
  const [phase, setPhase] = useState<"idle" | "frame" | "tracking">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => job.current?.abort(), []);
  const prepare = (range?: TrackingRange): Prepared => {
    if (!visualTarget) throw new Error("Choose a visual layer to follow an object.");
    const state = useCapture.getState();
    const snapshot = projectSnapshot(state);
    const active = snapshot.scenes.find(item => item.id === snapshot.currentSceneId);
    if (!active) throw new Error("Select a scene to track an object.");
    const selected = range ?? defaultTrackingRange(active, target, 0);
    if (!selected) throw new Error("Add a video beneath this layer to follow an object.");
    validateTrackingRange(active, target, selected);
    return { snapshot, fingerprint: nativeProjectFingerprint(snapshot), sceneId: active.id, range: selected };
  };
  const cancel = () => { job.current?.abort(); job.current = null; setFrame(null); setPhase("idle"); };
  const pick = async () => {
    if (job.current) return;
    const controller = new AbortController(); job.current = controller;
    setPhase("frame"); setError(null);
    try {
      const prepared = prepare();
      scrubPlayback(prepared.range.start);
      const captured = await captureTrackingFrame(prepared.snapshot, { kind: "object_tracking", sceneId: prepared.sceneId,
        ...prepared.range, target: { kind: "text", text: "Object" } }, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (nativeProjectFingerprint(projectSnapshot(useCapture.getState())) !== prepared.fingerprint)
        throw new Error("The project changed. Choose the object again.");
      setFrame({ ...captured, prepared });
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The video could not be read."); }
    finally { if (job.current === controller) { job.current = null; setPhase("idle"); } }
  };
  const run = async (prepared: Prepared, requestTarget: NativeTrackingTarget, step: TrackingStep) => {
    if (job.current || !visualTarget) return;
    const controller = new AbortController(); job.current = controller;
    setFrame(null); setPhase("tracking"); setError(null);
    try {
      if (nativeProjectFingerprint(projectSnapshot(useCapture.getState())) !== prepared.fingerprint)
        throw new Error("The project changed. Pick the object on the updated video.");
      const observation = await trackAssistantObject(prepared.snapshot, { kind: "object_tracking", sceneId: prepared.sceneId,
        ...prepared.range, target: requestTarget }, { signal: controller.signal });
      controller.signal.throwIfAborted();
      const placement = { anchor: "center" as const, offsetX: 0, offsetY: 0 };
      const changed = commitTrackedAnimation(visualTarget, observation, prepared.fingerprint, placement, { requestTarget, step });
      if (changed) {
        const state = useCapture.getState();
        notifyAssistantApplied({ localId: state.localId, past: state.past, future: state.future,
          fingerprint: nativeProjectFingerprint(projectSnapshot(state)) },
        [{ kind: "animation.follow", sceneId: prepared.sceneId, target: visualTarget, observationId: observation.id, ...placement }], `follow:${Date.now()}`);
      }
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Object tracking could not complete."); }
    finally { if (job.current === controller) { job.current = null; setPhase("idle"); } }
  };
  return { tracking, frame, phase, error, pick, cancel,
    choose: (point: { x: number; y: number }) => { if (frame) void run(frame.prepared, { kind: "point", ...point }, 1); },
    retrack: () => {
      if (!tracking) return;
      try { void run(prepare(tracking.observation), tracking.requestTarget, tracking.step); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "The track could not be refreshed."); }
    },
  };
}
