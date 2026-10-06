import { validateCompiledAssistantOriginal, validateCompiledAssistantProposal } from "../../../packages/pvo-assistant/policy.js";
import { matchAttachmentOperation, validateCompiledServiceAttachment } from "../../../packages/pvo-assistant/attachments/index.js";
import { HttpError } from "../../http.js";
import { validateWordTiming } from "./wordTimingPolicy.js";
import { validateNativeAnimation } from "./animationPolicy.js";
import { validateTrackingFollow, validateTrackingRange } from "./trackingPolicy.js";

const EPSILON = 0.002;
const createsObjects = new Set(["component.add", "text.add", "scene.add", "scene.duplicate",
  "clip.duplicate", "clip.split", "audio.extract", "audio.split"]);
function sceneIn(project, sceneId) {
  const scene = project.scenes.find(item => item.id === sceneId);
  if (!scene) throw new Error("Choose an existing scene ID.");
  return scene;
}
function validRange(start, end, duration) {
  if (start > end || end > duration + EPSILON) throw new Error("Choose a range within the scene duration.");
}
function missingObject(kind, result) {
  const diagnostic = `Choose an existing ${kind} ID from the supplied project. Never guess a newly created object's ID.`;
  if (!result.operations.some(operation => createsObjects.has(operation.kind))) return new Error(diagnostic);
  return new Error(`${diagnostic} This reply includes creation operations, but none execute inside the reply. Return ONLY the creation operations and independent operations using existing IDs now. Remove follow-ups targeting newly created objects. The next turn will supply their actual generated IDs; use those IDs then.`);
}

function needsTranscriptTimingRefinement(supplied, requested) {
  const duration = requested.end - requested.start;
  const suppliedDuration = supplied.end - supplied.start;
  // A smaller window can locate speech inside a coarse segment. Re-reading the
  // same broad range cannot improve timing, and observed silence needs no retry.
  if (!supplied.text.trim() || duration >= suppliedDuration - EPSILON || duration > suppliedDuration / 2 + EPSILON) return false;
  const segments = supplied.segments ?? [];
  if (!segments.length) return true;
  return segments.some(segment => segment.start < requested.end && segment.end > requested.start
    && segment.end - segment.start > duration + EPSILON);
}

/** Context and media must be bounded before any model call. */
export function validateNativeInput(request) {
  if (!request.prompt.trim()) throw new Error("Provide an editing request or question.");
  const project = request.project;
  const ids = new Set(project.scenes.map(scene => scene.id));
  if (ids.size !== project.scenes.length || !ids.has(project.currentSceneId))
    throw new Error("The project must contain unique scene IDs and the current scene.");
  let count = 0;
  let imageBytes = 0;
  for (const observation of request.observations) {
    if (!["frames", "transcript", "word_timing", "object_tracking", "unavailable"].includes(observation.kind)) continue;
    const scene = sceneIn(project, observation.sceneId);
    if (observation.kind === "unavailable") continue;
    validRange(observation.start, observation.end, scene.duration);
    if (observation.kind === "object_tracking") {
      validateTrackingRange(scene, observation);
      continue;
    }
    if (observation.kind === "word_timing") {
      validateWordTiming(scene, observation, true);
      continue;
    }
    if (observation.kind === "transcript") {
      if (observation.end - observation.start > 60 + EPSILON)
        throw new Error("Transcribe at most 60 seconds at a time.");
      for (const segment of observation.segments ?? []) {
        validRange(segment.start, segment.end, observation.end);
        if (segment.start < observation.start) throw new Error("Transcript timings must match the observed range.");
      }
      continue;
    }
    if (!observation.frames.length) throw new Error("A frame observation must contain sampled frames.");
    for (const frame of observation.frames) {
      count++;
      imageBytes += frame.dataUrl.length;
      if (frame.sceneTime < observation.start - EPSILON || frame.sceneTime > observation.end + EPSILON)
        throw new Error("Frame timestamps must match the observed range.");
      if (frame.clipId === null) {
        if (frame.sourceTime !== null) throw new Error("A frame without video cannot have a source time.");
      } else {
        const clip = scene.clips.find(item => item.id === frame.clipId);
        if (!clip || frame.sourceTime === null || frame.sceneTime < clip.start - EPSILON || frame.sceneTime > clip.end + EPSILON)
          throw new Error("A sampled frame must refer to its source clip.");
        const sourceTime = clip.sourceIn + (frame.sceneTime - clip.start) * clip.speed;
        if (Math.abs(sourceTime - frame.sourceTime) > EPSILON)
          throw new Error("Frame source and timeline timestamps do not agree.");
      }
    }
  }
  if (count > 6 || imageBytes > 2 * 1024 * 1024)
    throw new HttpError(413, "Inspect at most six smaller video frames at a time.");
  const withoutImages = request.observations.map(observation => observation.kind === "frames"
    ? { ...observation, frames: observation.frames.map(({ dataUrl: _image, ...frame }) => frame) }
    : observation);
  if (new TextEncoder().encode(JSON.stringify({ ...request, observations: withoutImages })).byteLength > 48 * 1024)
    throw new HttpError(413, "This project context is too large for the assistant. Use a smaller project.");
}

/** Server validation improves repair feedback; the editor still owns atomic command validation. */
export async function validateNativeResult(request, result, compile, attachment) {
  if (!result.message.trim()) throw new Error("Provide a concise user-facing message.");
  if (request.mode === "ask" && result.operations.length)
    throw new Error("Ask mode cannot return editing or playback operations.");
  if (result.operations.length && result.observations.length)
    throw new Error("Inspect footage before returning operations; do not combine both in one turn.");
  if (attachment && result.operations.filter(operation => matchAttachmentOperation(operation, attachment)).length !== 1)
    throw new Error("A verified attachment must match exactly one component proposal.");
  let frames = 0;
  for (const observation of result.observations) {
    if (!["frames", "transcript", "word_timing", "object_tracking"].includes(observation.kind)) continue;
    const scene = sceneIn(request.project, observation.sceneId);
    validRange(observation.start, observation.end, scene.duration);
    if (observation.end <= observation.start) throw new Error("Choose a nonempty observation range.");
    if (observation.kind === "object_tracking") {
      validateTrackingRange(scene, observation);
    } else if (observation.kind === "frames") {
      frames += observation.count;
    } else if (observation.kind === "word_timing") {
      validateWordTiming(scene, observation);
    } else {
      if (observation.end - observation.start > 60)
        throw new Error("Request at most 60 seconds of transcription per observation.");
      const supplied = request.observations.filter(result => result.kind === "transcript"
        && result.sceneId === observation.sceneId && observation.start >= result.start - EPSILON
        && observation.end <= result.end + EPSILON);
      if (supplied.length && !supplied.every(result => needsTranscriptTimingRefinement(result, observation)))
        throw new Error("This transcript range is already supplied; use transcript evidence to proceed instead of requesting it again. Timing refinement may inspect a window at most half as long only when existing speech has no timestamps or an overlapping segment is longer than that window.");
    }
  }
  if (frames > 6) throw new Error("Request no more than six sampled frames in one turn.");
  for (const operation of result.operations) {
    if (operation.kind === "export.prepare" || operation.kind === "project.ratio" || operation.kind === "playback.play" || operation.kind === "playback.pause") continue;
    const scene = sceneIn(request.project, operation.kind === "scene.add" ? operation.parentId : operation.sceneId);
    if (operation.kind === "font.apply") {
      const target = operation.target.kind === "component" ? scene.components : scene.texts;
      if (!target.some(item => item.id === operation.target.id)) throw missingObject(operation.target.kind, result);
      continue;
    }
    if (operation.kind.startsWith("animation.")) {
      validateNativeAnimation(scene, operation);
      if (operation.kind === "animation.follow") validateTrackingFollow(request, scene, operation);
      continue;
    }
    if (operation.clipId !== undefined && !scene.clips.some(clip => clip.id === operation.clipId))
      throw missingObject("clip", result);
    if (operation.audioId !== undefined && !scene.audioClips.some(clip => clip.id === operation.audioId))
      throw missingObject("audio", result);
    if (operation.textId !== undefined && !scene.texts.some(text => text.id === operation.textId))
      throw missingObject("text", result);
    const component = operation.componentId === undefined ? null : scene.components.find(item => item.id === operation.componentId);
    if (operation.componentId !== undefined && !component)
      throw missingObject("component", result);
    if (operation.kind === "component.update" && operation.changes.responsePolicy !== undefined
      && component.type === "tooltip")
      throw new Error("Display-only Notes cannot define a response policy.");
    if (operation.kind === "playback.seek" && operation.time > scene.duration)
      throw new Error("Seek within the existing scene duration.");
    if (operation.kind === "component.style") {
      const originalSource = component.source ?? component.design;
      if (!originalSource) throw new Error("This component has no validated design to restyle.");
      const original = await compile(component.type, originalSource);
      const proposed = await compile(component.type, { ...originalSource, style: operation.style });
      validateCompiledAssistantProposal(original, proposed, {
        currentSceneId: scene.id, duration: scene.duration, scenes: request.project.scenes,
      });
      continue;
    }
    if (!operation.source) continue;
    if (operation.kind === "component.source" && !component.source)
      throw new Error("This component source is unavailable. Use component.content to preserve its existing behavior.");
    const type = operation.kind === "component.add" ? operation.componentType : component.type;
    const proposed = await compile(type, operation.source);
    const context = { currentSceneId: scene.id, duration: scene.duration, scenes: request.project.scenes };
    if (matchAttachmentOperation(operation, attachment)) {
      const original = component?.source ? await compile(type, component.source) : null;
      validateCompiledServiceAttachment(original, proposed, attachment, context);
      continue;
    }
    if (component?.source) {
      const original = await compile(type, component.source);
      validateCompiledAssistantProposal(original, proposed, context);
    } else {
      validateCompiledAssistantOriginal(proposed, context);
      if (proposed.rules.some(rule => rule.action.kind === "request"))
        throw new Error("Configure new network requests in the component editor first.");
    }
  }
}
