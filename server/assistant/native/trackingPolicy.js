export function validateTrackingRange(scene, observation) {
  const clip = scene.clips.find(item => item.id === observation.clipId);
  if (!clip || !clip.hasMedia) throw new Error("Object tracking needs an existing clip with video.");
  if (observation.end <= observation.start || observation.start < clip.start - 0.000001
    || observation.end > clip.end + 0.000001 || observation.end - observation.start > 10 + 0.000001)
    throw new Error("Track at most ten seconds inside one source clip.");
  if (observation.target?.kind === "text" && !observation.target.text.trim())
    throw new Error("Describe one object to track.");
}

export function validateTrackingFollow(request, scene, operation) {
  const observation = request.observations.find(item => item.kind === "object_tracking" && item.id === operation.observationId);
  if (!observation || observation.sceneId !== scene.id) throw new Error("Follow needs an actual completed object-tracking observation ID from this request.");
  validateTrackingRange(scene, observation);
  if (operation.target.kind === "clip" && operation.target.id !== observation.clipId)
    throw new Error("Camera tracking must target the same source clip that was inspected.");
}
