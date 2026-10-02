import type { NativeOperation } from "../../../../packages/pvo-assistant/native/index.js";

const labels: Record<NativeOperation["kind"], string> = {
  "font.apply": "Font updated",
  "animation.set": "Layer animated", "animation.remove": "Keyframe removed", "animation.clear": "Animation cleared",
  "animation.follow": "Object tracking applied",
  "text.add": "Text added", "text.update": "Text updated", "text.delete": "Text removed",
  "clip.trim": "Clip trimmed", "clip.split": "Clip split", "clip.move": "Clips reordered",
  "clip.duplicate": "Clip duplicated", "clip.delete": "Clip removed", "clip.update": "Clip adjusted",
  "audio.extract": "Audio extracted", "audio.update": "Audio adjusted", "audio.split": "Audio split",
  "audio.delete": "Audio removed", "scene.add": "Scene added", "scene.update": "Scene updated",
  "scene.delete": "Scene removed", "scene.duplicate": "Scene duplicated", "project.ratio": "Aspect ratio changed",
  "component.add": "Component added", "component.update": "Component adjusted",
  "component.source": "Component design updated", "component.delete": "Component removed",
  "component.content": "Component content updated", "component.style": "Component appearance updated",
  "playback.seek": "Preview moved", "playback.play": "Preview started", "playback.pause": "Preview paused",
  "export.prepare": "Export opened",
};

/** Notification copy comes from validated operation kinds, never generated prose or user text. */
export function appliedAssistantSummary(operations: readonly NativeOperation[]): string {
  const unique = [...new Set(operations.map(operation => labels[operation.kind]))];
  if (!unique.length) return "Changes applied.";
  let summary = unique[0];
  let included = 1;
  for (; included < unique.length; included++) {
    const candidate = `${summary} · ${unique[included]}`;
    const remaining = unique.length - included - 1;
    if (candidate.length + (remaining ? ` · +${remaining}`.length : 0) > 50) break;
    summary = candidate;
  }
  return summary + (included < unique.length ? ` · +${unique.length - included}` : "");
}
