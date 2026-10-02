import { objectTrackingTimes, type NativeObservationRequest } from "../../../../packages/pvo-assistant/native/index.js";
import { dur, total } from "../clips/timing";
import { inspectionScene, type InspectionProject } from "./mediaInspection";

export type ObjectTrackingRequest = Extract<NativeObservationRequest, { kind: "object_tracking" }>;

/** Tracking stays within one real video source and uses the scene clock after trims/speed. */
export function trackingInspection(project: InspectionProject, request: ObjectTrackingRequest) {
  const scene = inspectionScene(project, request);
  const times = objectTrackingTimes(request.start, request.end);
  const index = scene.clips.findIndex(clip => clip.id === request.clipId);
  const clip = scene.clips[index];
  if (!clip?.url) throw new Error("Select an existing imported video clip to track.");
  if (![clip.in, clip.out, clip.speed, clip.srcDur].every(Number.isFinite) || clip.in < 0
    || clip.out <= clip.in || clip.out > clip.srcDur + .000001 || clip.speed <= 0)
    throw new Error("The tracking clip has an invalid source range.");
  const start = total(scene.clips.slice(0, index));
  if (request.start < start - .000001 || request.end > start + dur(clip) + .000001)
    throw new Error("The whole tracking range must stay inside one video clip.");
  const target = request.target;
  if (target.kind === "text") {
    if (!target.text.trim() || target.text.length > 200) throw new Error("Describe one object to track.");
  } else if (target.kind !== "point" || !Number.isFinite(target.x) || !Number.isFinite(target.y)
    || target.x < 0 || target.x > 1 || target.y < 0 || target.y > 1)
    throw new Error("Choose a tracking point inside the video canvas.");
  return { scene, clip, samples: times.map(time => ({ time, sourceTime: clip.in + (time - start) * clip.speed })) };
}
