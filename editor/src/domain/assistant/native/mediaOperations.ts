import type { NativeOperation } from "../../../../../packages/pvo-assistant/native/index.js";
import { changeAudioGain } from "../../audio/gain";
import { dragAudio, extractClipAudio, splitAudio } from "../../audio/editing";
import { adjustClip } from "../../clips/adjustments";
import { removeClipAt, splitClipAt } from "../../clips/editing";
import { dur, total } from "../../clips/timing";
import { trimClip } from "../../clips/trim";
import type { Scene } from "../../project/model";

type MediaOperation = Extract<NativeOperation, { clipId: number } | { audioId: number }>;

export function applyMediaOperation(scene: Scene, operation: MediaOperation, createId: () => number): Scene {
  if ("clipId" in operation) {
    const index = scene.clips.findIndex(clip => clip.id === operation.clipId);
    const clip = scene.clips[index];
    if (!clip) throw new Error(`Clip ${operation.clipId} no longer exists in ${scene.name}.`);
    if (operation.kind === "clip.delete") return { ...scene, clips: removeClipAt(scene.clips, index) };
    if (operation.kind === "clip.duplicate") {
      const clips = [...scene.clips];
      clips.splice(index + 1, 0, { ...clip, id: createId() });
      return { ...scene, clips };
    }
    if (operation.kind === "clip.move") {
      if (operation.index >= scene.clips.length) throw new Error("The requested clip position does not exist.");
      const clips = removeClipAt(scene.clips, index);
      clips.splice(operation.index, 0, clip);
      return { ...scene, clips };
    }
    if (operation.kind === "clip.split") {
      const start = total(scene.clips.slice(0, index));
      if (operation.time <= start || operation.time >= start + dur(clip)) throw new Error("Split time must be inside the selected clip.");
      const split = splitClipAt(scene.clips, operation.time, createId);
      if (!split) throw new Error("Splitting must leave at least 0.15 seconds on each side.");
      return { ...scene, clips: split.clips };
    }
    if (operation.kind === "audio.extract") {
      const extracted = extractClipAudio(scene.clips, index, createId(), scene.muted, scene.clipGain);
      if (!extracted) throw new Error("This clip has no attached audio to extract.");
      return { ...scene, clips: extracted.clips,
        audioClips: [...scene.audioClips ?? [], extracted.audio] };
    }
    let updated = clip;
    if (operation.kind === "clip.update") updated = adjustClip(clip, operation.changes);
    if (operation.kind === "clip.trim") {
      const minimum = Math.min(dur(clip), 0.3);
      if (operation.sourceOut > clip.srcDur || operation.sourceOut - operation.sourceIn < minimum * clip.speed - 1e-8)
        throw new Error("Trim must stay inside the source and retain a playable clip.");
      // Extend the right edge first so a valid later source range is not constrained by the old end.
      if (operation.sourceOut > clip.out) updated = trimClip(updated, "r", (operation.sourceOut - updated.out) / clip.speed, minimum);
      updated = trimClip(updated, "l", (operation.sourceIn - updated.in) / clip.speed, minimum);
      updated = trimClip(updated, "r", (operation.sourceOut - updated.out) / clip.speed, minimum);
    }
    return { ...scene, clips: scene.clips.map(item => item.id === clip.id ? updated : item) };
  }
  const clips = scene.audioClips ?? [];
  const clip = clips.find(item => item.id === operation.audioId);
  if (!clip) throw new Error(`Audio ${operation.audioId} no longer exists in ${scene.name}.`);
  if (operation.kind === "audio.delete") return { ...scene, audioClips: clips.filter(item => item.id !== clip.id) };
  if (operation.kind === "audio.split") {
    const parts = splitAudio(clip, operation.time, createId());
    if (!parts) throw new Error("Audio splitting must leave at least 0.1 seconds on each side.");
    return { ...scene, audioClips: clips.flatMap(item => item.id === clip.id ? parts : [item]) };
  }
  const changes = operation.changes;
  const sourceIn = changes.sourceIn ?? clip.in;
  const sourceOut = changes.sourceOut ?? clip.out;
  if (sourceOut > clip.srcDur || sourceOut - sourceIn < Math.min(0.1 * clip.speed, clip.out - clip.in) - 1e-8)
    throw new Error("Audio trim must retain a playable source range.");
  const moved = dragAudio(clip, "move", (changes.start ?? clip.start) - clip.start);
  const updated = { ...(changes.gain === undefined ? moved : changeAudioGain(moved, changes.gain)),
    in: sourceIn, out: sourceOut, muted: changes.muted ?? clip.muted };
  return { ...scene, audioClips: clips.map(item => item.id === clip.id ? updated : item) };
}
