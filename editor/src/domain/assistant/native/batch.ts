import { DEFAULT_TEXT_STYLE } from "../../../../../packages/pvo-text-runtime/index.js";
import { parseNativeOperation, type NativeOperation } from "../../../../../packages/pvo-assistant/native/index.js";
import { changeSceneAudioGain } from "../../audio/gain";
import { changeLayerAnimation } from "../../animation/editing";
import { createTrackedAnimation } from "../../animation/trackedAuthoring";
import { nativeTrackingFingerprint } from "../../animation/trackingEvidence";
import { layerOrder } from "../../layers/order";
import type { ProjectSnapshot, Scene } from "../../project/model";
import { cloneScenes } from "../../project/snapshot";
import { duplicateSceneData } from "../../scenes/duplicate";
import { removeSceneSubtree } from "../../scenes/deletion";
import { sceneDuration } from "../../scenes/duration";
import { nextSceneName } from "../../scenes/rules";
import { createTextOverlay, updateTextOverlay } from "../../text/editing";
import { applyComponentOperation, validateNativeComponentRoutes } from "./componentOperations";
import { applyMediaOperation } from "./mediaOperations";
import { nativePreparationReceipt, nativeReceiptValues } from "./receipts";
import { applyFontOperation } from "./fontOperations";
import type { NativeBatch, NativePlaybackOperation, NativePreparation } from "./types";
export type { NativeBatch, NativePreparation, NativePlaybackOperation } from "./types";
export { validateNativeBatchEditingMode } from "./componentOperations";

function copy(project: ProjectSnapshot): ProjectSnapshot {
  return { ...project, scenes: cloneScenes(project.scenes), allowedDomains: [...project.allowedDomains] };
}
function cancelled(options: NativePreparation) {
  if (options.signal?.aborted) {
    const error = new Error("Assistant editing was stopped.");
    error.name = "AbortError";
    throw error;
  }
}
function updateText(scene: Scene, operation: Extract<NativeOperation, { textId: number } | { kind: "text.add" }>, createId: () => number): Scene {
  const original = operation.kind === "text.add"
    ? createTextOverlay(createId(), operation.text, operation.start)
    : scene.texts.find(text => text.id === operation.textId);
  if (!original) throw new Error("The requested text layer no longer exists in this scene.");
  if (operation.kind === "text.delete") return { ...scene, texts: scene.texts.filter(text => text.id !== original.id) };
  const changes = operation.kind === "text.add" ? operation : operation.changes;
  const next = updateTextOverlay(original, {
    ...(changes.text === undefined ? {} : { text: changes.text }),
    ...(changes.start === undefined ? {} : { start: changes.start }),
    ...(changes.end === undefined ? {} : { end: changes.end }),
    ...(changes.x === undefined ? {} : { x: changes.x }),
    ...(changes.y === undefined ? {} : { y: changes.y }),
    ...(changes.style ? { style: { ...DEFAULT_TEXT_STYLE, ...original.style, ...changes.style } } : {}),
  });
  if (next.end - next.start < 0.1 - 1e-8) throw new Error("Text must stay visible for at least 0.1 seconds.");
  return { ...scene, texts: operation.kind === "text.add" ? [...scene.texts, next]
    : scene.texts.map(text => text.id === original.id ? next : text) };
}

/** Pending host effects must still be valid after every follow-up changes the candidate. */
export function validateNativeBatchEffects({ project, playback, exportFormat }: Pick<NativeBatch, "project" | "playback" | "exportFormat">): void {
  if (exportFormat && !project.scenes.some(scene => sceneDuration(scene) > 0))
    throw new Error("Add footage or an authored layer before exporting.");
  for (const operation of playback) if (operation.kind === "playback.seek") {
    const scene = project.scenes.find(item => item.id === operation.sceneId);
    if (!scene || operation.time > sceneDuration(scene))
      throw new Error("The final edit no longer contains the requested playback position.");
  }
}

/** Work on an isolated snapshot; a failed/cancelled operation never exposes a partial project. */
export async function prepareNativeBatch(before: ProjectSnapshot, input: readonly NativeOperation[], options: NativePreparation): Promise<NativeBatch> {
  if (input.length > 24) throw new Error("An assistant edit batch supports at most 24 operations.");
  const operations = input.map(parseNativeOperation);
  let project = copy(before);
  const playback: NativePlaybackOperation[] = [];
  const receipts: NativeBatch["receipts"] = [];
  let exportFormat: NativeBatch["exportFormat"] = null;
  for (const operation of operations) {
    cancelled(options);
    const previousValues = nativeReceiptValues(project);
    let failed = false;
    try {
      if (operation.kind === "playback.play" || operation.kind === "playback.pause") {
        playback.push(operation);
        continue;
      }
      if (operation.kind === "export.prepare") {
        exportFormat = operation.format;
        continue;
      }
      if (operation.kind === "project.ratio") {
        project = { ...project, ratio: operation.ratio };
        continue;
      }
      if (operation.kind === "scene.add") {
        if (!project.scenes.some(scene => scene.id === operation.parentId)) throw new Error("The new scene's parent no longer exists.");
        const scene: Scene = { id: `scene-${options.createId()}`, parent: operation.parentId,
          name: operation.name.trim() || nextSceneName(project.scenes, operation.parentId),
          clips: [], texts: [], components: [], audioClips: [], muted: false, sound: 0 };
        project.scenes.push(scene);
        continue;
      }
      const scene = project.scenes.find(item => item.id === operation.sceneId);
      if (!scene) throw new Error(`Scene ${operation.sceneId} no longer exists.`);
      if (operation.kind === "playback.seek") {
        if (operation.time > sceneDuration(scene)) throw new Error("Seek time is outside this scene.");
        playback.push(operation);
        continue;
      }
      if (operation.kind === "scene.duplicate") {
        project.scenes.push(duplicateSceneData(scene, project.scenes, `scene-${options.createId()}`, options.createId));
        continue;
      }
      if (operation.kind === "scene.delete") {
        if (scene.id === "main") throw new Error("The main scene cannot be deleted.");
        const removed = removeSceneSubtree(project.scenes, scene.id);
        project = { ...project, scenes: removed.scenes,
          currentSceneId: removed.deleted.has(project.currentSceneId) ? removed.parent : project.currentSceneId };
        continue;
      }
      let updated = scene;
      if (operation.kind === "font.apply") {
        updated = applyFontOperation(scene, operation, options.fonts);
      } else if (operation.kind === "animation.follow") {
        const evidence = options.trackingEvidence?.find(item => item.observation.id === operation.observationId);
        if (!evidence || evidence.fingerprint !== nativeTrackingFingerprint(project, evidence.observation.sceneId, evidence.observation.clipId))
          throw new Error("Follow requires a completed, current object-tracking observation from this request.");
        updated = createTrackedAnimation(project, operation.target, evidence.observation, operation,
          evidence.requestTarget);
      } else if (operation.kind === "animation.set") {
        updated = changeLayerAnimation(scene, operation.target, { kind: "tracks", tracks: operation.tracks });
      } else if (operation.kind === "animation.remove") {
        updated = changeLayerAnimation(scene, operation.target, { kind: "remove", property: operation.property, time: operation.time });
      } else if (operation.kind === "animation.clear") {
        updated = changeLayerAnimation(scene, operation.target, { kind: "clear", property: operation.property });
      } else if (operation.kind === "scene.update") {
        if (operation.changes.name !== undefined && !operation.changes.name.trim()) throw new Error("A scene needs a name.");
        updated = { ...scene, ...operation.changes };
        if (operation.changes.musicGain !== undefined) updated = changeSceneAudioGain(updated, "music", operation.changes.musicGain);
        if (operation.changes.clipGain !== undefined) updated = changeSceneAudioGain(updated, "clip", operation.changes.clipGain);
      } else if ("clipId" in operation || "audioId" in operation) {
        updated = applyMediaOperation(scene, operation, options.createId);
      } else if (operation.kind === "text.add" || "textId" in operation) {
        updated = updateText(scene, operation, options.createId);
      } else {
        updated = await applyComponentOperation(project, scene, operation, options);
      }
      project.scenes = project.scenes.map(item => item.id === scene.id ? { ...updated, layers: layerOrder(updated) } : item);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!failed) receipts.push(nativePreparationReceipt(operation, previousValues, nativeReceiptValues(project)));
    }
  }
  cancelled(options);
  if (JSON.stringify(project) !== JSON.stringify(before)) validateNativeComponentRoutes(project);
  validateNativeBatchEffects({ project, playback, exportFormat });
  return { before: copy(before), project, operations, receipts, playback, exportFormat, advancedEditingEnabled: options.advancedEditingEnabled };
}
