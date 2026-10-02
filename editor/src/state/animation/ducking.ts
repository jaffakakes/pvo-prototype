import { duckAuthoringVolume, type SpeechRange } from "../../domain/animation/ducking";
import type { AnimationTarget } from "../../domain/animation/model";
import { getAnimationTarget } from "../../domain/animation/targets";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import { MAX_TRANSCRIPT_SECONDS, inspectionAudio } from "../../domain/assistant/mediaInspection";
import { transcribeAssistantAudio } from "../../infrastructure/assistant/media/transcript";
import { useCapture } from "../captureStore";
import { projectSnapshot } from "../project/history";
import { notifyAssistantApplied } from "../assistant/nativeAppliedNotification";
import { canAuthorAnimation } from "./access";
import { useAnimationSelection } from "./selection";

/** Observe real speech on a private snapshot, then apply one verified volume edit. */
export async function duckAudioUnderSpeech(target: AnimationTarget, { signal,
  transcribe = transcribeAssistantAudio,
}: { signal: AbortSignal; transcribe?: typeof transcribeAssistantAudio }): Promise<boolean> {
  const current = useCapture.getState();
  if (!canAuthorAnimation(current)) throw new Error("Finish the current operation before ducking audio.");
  if (target.kind !== "music" && target.kind !== "audio") throw new Error("Select music or an audio layer first.");
  const before = projectSnapshot(current);
  const fingerprint = nativeProjectFingerprint(before);
  const scene = before.scenes.find(item => item.id === before.currentSceneId);
  const info = scene && getAnimationTarget(scene, target);
  if (!scene || !info) throw new Error("The selected audio layer no longer exists.");
  // Music is generated separately from inspection audio. Exclude an independently
  // selected sound layer too, so its own vocals cannot duck that layer against itself.
  const inspectedScene = target.kind === "audio"
    ? { ...scene, audioClips: scene.audioClips?.filter(clip => clip.id !== target.id) } : scene;
  const project = { ...before, scenes: before.scenes.map(item => item.id === scene.id ? inspectedScene : item) };
  const timeout = AbortSignal.timeout(180000);
  const active = AbortSignal.any([signal, timeout]);
  const ranges: SpeechRange[] = [];
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (timeout.aborted) throw new Error("Speech analysis took too long. Try a shorter audio layer.");
    if (useCapture.getState().localId !== current.localId
      || nativeProjectFingerprint(projectSnapshot(useCapture.getState())) !== fingerprint)
      throw new Error("The project changed during speech analysis. Run ducking again on the updated audio.");
  };
  for (let start = info.start; start < info.end; start += MAX_TRANSCRIPT_SECONDS) {
    assertCurrent();
    const request = { kind: "transcript" as const, sceneId: scene.id, start, end: Math.min(info.end, start + MAX_TRANSCRIPT_SECONDS) };
    if (!inspectionAudio(inspectedScene, request).length) continue;
    const transcript = await transcribe(project, request, { signal: active }).catch(error => {
      assertCurrent();
      throw error;
    });
    assertCurrent();
    ranges.push(...(transcript.segments ?? []).filter(segment => segment.text.trim() && segment.end > segment.start)
      .map(segment => ({ start: segment.start, end: segment.end })));
  }
  assertCurrent();
  const next = duckAuthoringVolume(scene, target, ranges);
  const state = useCapture.getState();
  if (!canAuthorAnimation(state)) throw new Error("Finish the current operation before applying audio ducking.");
  if (next === scene) return false;
  state.edit({ scenes: state.scenes.map(item => item.id === scene.id ? next : item), playing: false });
  useAnimationSelection.getState().clear();
  const after = useCapture.getState();
  notifyAssistantApplied({ localId: after.localId, past: after.past, future: after.future,
    fingerprint: nativeProjectFingerprint(projectSnapshot(after)) }, [], `ducking:${crypto.randomUUID()}`);
  return true;
}
