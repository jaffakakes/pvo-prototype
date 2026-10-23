const object = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Guard collection shapes before semantic passes dereference their members. */
export function manifestShapeErrors(manifest) {
  const errors = [];
  function collection(value, path, required = false) {
    if (value === undefined && !required) return [];
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array.`);
      return [];
    }
    return value.filter((entry, index) => {
      if (object(entry)) return true;
      errors.push(`${path}[${index}] must be an object.`);
      return false;
    });
  }
  for (const key of ["scenes", "components", "media", "hotspots", "triggers"])
    collection(manifest[key], key, key === "scenes" || key === "components");
  if (manifest.playback !== undefined) {
    if (!object(manifest.playback)) errors.push("playback must be an object.");
    else
      for (const [index, timeline] of collection(
        manifest.playback.timelines,
        "playback.timelines",
        true,
      ).entries())
        collection(timeline.clips, `playback.timelines[${index}].clips`, true);
  }
  if (Array.isArray(manifest.components))
    for (const [index, component] of manifest.components.entries()) {
      if (!object(component)) continue;
      collection(component.options, `components[${index}].options`);
      for (const [fieldIndex, field] of collection(
        component.fields,
        `components[${index}].fields`,
      ).entries())
        collection(
          field.options,
          `components[${index}].fields[${fieldIndex}].options`,
        );
      // Card buttons are labelled action wrappers, rather than bare actions.
      if (component.kind === "card" && Array.isArray(component.actions))
        collection(component.actions, `components[${index}].actions`);
    }
  return errors;
}
