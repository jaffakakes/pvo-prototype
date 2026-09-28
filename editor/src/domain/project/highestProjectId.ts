import type { ProjectSnapshot } from "./model";

function generatedId(value: string, prefix: string): number {
  if (!value.startsWith(prefix)) return 0;
  const suffix = value.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return 0;
  const id = Number(suffix);
  return Number.isSafeInteger(id) ? id : 0;
}

/** IDs in undo/redo matter too: restoring one must not collide with a new item. */
export function highestProjectId(projects: ProjectSnapshot[]): number {
  let highest = 0;
  for (const project of projects) {
    for (const scene of project.scenes) {
      highest = Math.max(highest, generatedId(scene.id, "scene-"));
      for (const clip of scene.clips) highest = Math.max(highest, clip.id);
      for (const clip of scene.audioClips ?? []) highest = Math.max(highest, clip.id);
      for (const text of scene.texts) highest = Math.max(highest, text.id);
      for (const component of scene.components)
        highest = Math.max(highest, generatedId(component.id, "component-"));
    }
  }
  return highest;
}
