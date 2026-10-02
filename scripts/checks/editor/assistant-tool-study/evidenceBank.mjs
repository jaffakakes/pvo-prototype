import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const observationKey = request => JSON.stringify(canonical(request));

export async function loadEvidenceBank(file) {
  const bank = JSON.parse(await readFile(file, "utf8"));
  assert.equal(bank.schemaVersion, 1);
  assert(Array.isArray(bank.entries) && Array.isArray(bank.vision));
  assert(bank.source?.sha256 && bank.sharedInstruction);
  for (const entry of bank.entries) {
    assert(entry.mapping && entry.request && entry.result && entry.provenance);
    for (const frame of entry.result.frames ?? []) {
      const bytes = Buffer.from(frame.dataUrl.split(",")[1], "base64");
      assert(bank.vision.some(item => item.imageSha256 === sha256(bytes)), "Every frame requires frozen vision evidence");
    }
  }
  return bank;
}

/** This study has one verified source asset; transient blob URLs are deliberately excluded. */
export function studyMediaMapping(project, sceneId) {
  const scene = project.scenes.find(item => item.id === sceneId);
  if (!scene || scene.clips.length !== 1 || (scene.audioClips?.length ?? 0)) return null;
  const clip = scene.clips[0];
  return { sceneId, clipId: clip.id, sourceIn: clip.in, sourceOut: clip.out, speed: clip.speed,
    muted: Boolean(scene.muted), clipGain: scene.clipGain ?? 1, audioDetached: Boolean(clip.audioDetached),
    sourceDuration: clip.srcDur };
}

/** Exact lookup only: no invented transcript, guessed frame, range interpolation or hidden nearest match. */
export function lookupFrozenObservation(bank, project, request) {
  const mapping = studyMediaMapping(project, request.sceneId);
  const entry = bank.entries.find(item => observationKey(item.request) === observationKey(request)
    && observationKey(item.mapping) === observationKey(mapping));
  if (entry) return structuredClone(entry.result);
  return { kind: "unavailable", sceneId: request.sceneId, requestedKind: request.kind,
    message: "This exact request/source mapping is not in the registered frozen evidence bank. This is unavailable evidence, not silence or absence. Use the declared inspection menu, or acknowledge the unresolved question." };
}
