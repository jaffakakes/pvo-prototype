/** Public project metadata is sufficient to validate animation targets and scene-time commands. */
export function validateNativeAnimation(scene, operation) {
  const { target } = operation;
  if (!target) return;
  let start = 0;
  let end = scene.duration;
  if (target.kind !== "music") {
    const collection = { clip: "clips", audio: "audioClips", text: "texts", component: "components" }[target.kind];
    const layer = scene[collection].find(item => item.id === target.id);
    if (!layer) throw new Error("Choose an existing animation layer ID from the supplied project.");
    if (target.kind === "component") {
      start = layer.at;
      end = layer.duration === null
        ? scene.clips.find(clip => clip.end > start)?.end ?? Math.max(0, ...scene.clips.map(clip => clip.end))
        : start + layer.duration;
    } else {
      start = layer.start;
      end = layer.end;
    }
  }
  const times = operation.kind === "animation.set"
    ? Object.values(operation.tracks).flat().map(frame => frame.time)
    : operation.kind === "animation.remove" ? [operation.time] : [];
  if (times.some(time => time < start - 0.000001 || time > end + 0.000001))
    throw new Error("Animation keyframe times must be inside the selected layer's scene range.");
}
