/** Tree metadata is optional for legacy manifests, but complete when supplied. */
export function validateSceneTree(scenes, errors) {
  if (!scenes.some(scene => scene && Object.hasOwn(scene, "parent"))) return;
  const byId = new Map(scenes.map(scene => [scene?.id, scene]));
  const roots = scenes.filter(scene => scene?.parent === null);
  if (roots.length !== 1) errors.push("Scene tree must have exactly one root with parent null.");

  for (const [index, scene] of scenes.entries()) {
    const path = `scenes[${index}].parent`;
    if (scene?.parent === null) continue;
    if (typeof scene?.parent !== "string" || !scene.parent) {
      errors.push(`${path} must be a scene ID or null for the root.`);
      continue;
    }
    if (!byId.has(scene.parent)) {
      errors.push(`${path} references missing scene "${scene.parent}".`);
      continue;
    }
    const visited = new Set([scene.id]);
    let parent = scene.parent;
    while (typeof parent === "string") {
      if (visited.has(parent)) {
        errors.push(`${path} creates a cycle in the scene tree.`);
        break;
      }
      visited.add(parent);
      parent = byId.get(parent)?.parent;
    }
  }
}
