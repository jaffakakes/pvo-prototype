import type { NativeOperation, NativeObservationRequest } from "../../../../packages/pvo-assistant/native/index.js";

const labels: Record<NativeOperation["kind"], string> = {
  "animation.set": "Animate layer", "animation.remove": "Remove keyframe", "animation.clear": "Clear animation",
  "animation.follow": "Follow tracked object",
  "text.add": "Add text", "text.update": "Update text", "text.delete": "Remove text",
  "clip.trim": "Trim clip", "clip.split": "Split clip", "clip.move": "Reorder clip",
  "clip.duplicate": "Duplicate clip", "clip.delete": "Remove clip", "clip.update": "Adjust clip",
  "audio.extract": "Extract clip audio", "audio.update": "Adjust audio", "audio.split": "Split audio",
  "audio.delete": "Remove audio", "scene.add": "Add scene", "scene.update": "Update scene",
  "scene.delete": "Remove scene", "project.ratio": "Change aspect ratio",
  "scene.duplicate": "Duplicate scene", "export.prepare": "Prepare export",
  "component.add": "Add component", "component.update": "Adjust component",
  "component.source": "Edit component design", "component.delete": "Remove component",
  "component.content": "Update component content",
  "component.style": "Edit component appearance",
  "playback.seek": "Seek preview", "playback.play": "Play preview", "playback.pause": "Pause preview",
};

export function nativeOperationLabel(operation: NativeOperation): string {
  if (operation.kind === "text.add") return `Add “${operation.text.slice(0, 80)}” (${operation.start}s–${operation.end}s)`;
  if (operation.kind === "clip.trim") return `Trim clip to source ${operation.sourceIn}s–${operation.sourceOut}s`;
  if (operation.kind === "playback.seek") return `Preview at ${operation.time}s`;
  if (operation.kind === "scene.add") return `Add scene “${operation.name}”`;
  return labels[operation.kind];
}

export function nativeObservationLabel(observation: NativeObservationRequest) {
  const action = { frames: "Inspecting video", transcript: "Transcribing audio", word_timing: "Aligning speech", object_tracking: "Tracking object" };
  return `${action[observation.kind]} · ${observation.start}s–${observation.end}s`;
}
