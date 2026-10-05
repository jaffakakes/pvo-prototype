import type { CaptureState } from "../types";
import type { NativeMode } from "../../../../packages/pvo-assistant/native/index.js";
import {
  validateNativeBatchEditingMode,
  validateNativeBatchEffects,
  type NativeBatch,
} from "../../domain/assistant/native/batch";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../captureStore";
import { useEditorPreferences } from "../preferences/editorPreferences";
import { projectSnapshot } from "../project/history";

/** One complete, validated project update enters history; playback stays with its host adapter. */
export function nativeBatchCommitValues(
  batch: NativeBatch,
  expectedFingerprint: string,
  mode: NativeMode,
): Partial<CaptureState> | null {
  if (mode !== "edit")
    throw new Error(
      "Only an edit command can apply a validated assistant batch.",
    );
  const state = useCapture.getState();
  if (
    state.screen !== "editor" ||
    state.recording ||
    state.importing ||
    state.trim ||
    state.ex === "running" ||
    state.tryMode ||
    state.playheadPick
  )
    throw new Error(
      "Finish recording, export or preview before applying assistant edits.",
    );
  const current = projectSnapshot(state);
  if (
    nativeProjectFingerprint(current) !== expectedFingerprint ||
    JSON.stringify(current) !== JSON.stringify(batch.before)
  )
    throw new Error(
      "The project changed while the assistant was working. Please ask again.",
    );
  validateNativeBatchEffects(batch);
  validateNativeBatchEditingMode(
    batch,
    useEditorPreferences.getState().advancedEditingEnabled,
  );
  if (JSON.stringify(batch.project) === JSON.stringify(batch.before))
    return null;
  const active = batch.project.scenes.find(
    (scene) => scene.id === batch.project.currentSceneId,
  )!;
  return {
    scenes: batch.project.scenes,
    currentSceneId: batch.project.currentSceneId,
    ratio: batch.project.ratio,
    allowedDomains: batch.project.allowedDomains,
    playing: false,
    t: Math.min(state.t, sceneDuration(active)),
    trim: null,
    ...(state.sel >= 0
      ? {
          sel:
            active.id === state.currentSceneId
              ? active.clips.findIndex(
                  (clip) => clip.id === state.clips[state.sel]?.id,
                )
              : -1,
        }
      : {}),
  };
}

export function commitNativeBatch(
  batch: NativeBatch,
  expectedFingerprint: string,
  mode: NativeMode,
): boolean {
  const values = nativeBatchCommitValues(batch, expectedFingerprint, mode);
  if (!values) return false;
  useCapture.getState().edit(values);
  return true;
}
