import type { NativeObjectTrackingObservation, NativeTrackingTarget, NativeVisualAnimationTarget } from "../../../../packages/pvo-assistant/native/index.js";
import { createTrackedAnimation } from "../../domain/animation/trackedAuthoring";
import type { TrackingStep } from "../../domain/animation/trackingMetadata";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import { useAssistant } from "../assistant/assistantStore";
import { useCapture } from "../captureStore";
import { projectSnapshot } from "../project/history";

/** Manual tracking and AI following share one rule; a completed job creates one Undo. */
export function commitTrackedAnimation(target: NativeVisualAnimationTarget,
  observation: NativeObjectTrackingObservation, expectedFingerprint: string,
  placement: { anchor: "center" | "top"; offsetX: number; offsetY: number },
  options: { requestTarget: NativeTrackingTarget; step?: TrackingStep }): boolean {
  const state = useCapture.getState();
  if (state.screen !== "editor" || state.recording || state.importing || state.tryMode || state.playheadPick
    || state.trim || state.ex === "running" || useAssistant.getState().phase !== "idle")
    throw new Error("Finish the current editing operation before applying tracking.");
  if (nativeProjectFingerprint(projectSnapshot(state)) !== expectedFingerprint)
    throw new Error("The project changed while tracking. Run tracking again on the updated video.");
  const scene = state.scenes.find(item => item.id === observation.sceneId);
  if (!scene || scene.id !== state.currentSceneId) throw new Error("Return to the tracked scene and try again.");
  const next = createTrackedAnimation(projectSnapshot(state), target, observation, placement,
    options.requestTarget, options.step);
  if (next === scene) return false;
  state.edit({ scenes: state.scenes.map(item => item.id === scene.id ? next : item), playing: false });
  return true;
}
