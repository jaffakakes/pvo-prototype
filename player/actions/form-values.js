/** Validate native and sandbox form messages against declared controls. */
export function formValuesForComponent(component, value, structure) {
  if (component.kind !== "form" || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Those form values are not valid.");
  }
  const fields = structure?.type === "form" ? structure.fields : component.fields;
  if (!Array.isArray(fields)) throw new Error("This form has no declared fields.");
  const declared = new Map(fields.map(field => [field.name, field]));
  const entries = Object.entries(value);
  if (entries.length > 20 || !entries.every(([key, entry]) =>
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) && !["constructor", "prototype", "__proto__"].includes(key)
      && declared.has(key) && ["string", "number", "boolean"].includes(typeof entry) && String(entry).length <= 1024)) {
    throw new Error("Those form values are not valid.");
  }
  const modernStructure = structure?.type === "form" && (structure.heading !== undefined || structure.waiting !== undefined || structure.fields.some(field => field.label !== undefined || field.kind === "number"));
  if (!component.restyle_capture?.form && !modernStructure) return Object.fromEntries(entries);
  const supplied = new Map(entries);
  return Object.fromEntries(fields.map(field => {
    const name = field.name;
    const value = supplied.get(name) ?? (field.kind === "yesno" ? false : "");
    if ((field.type === "number" || field.kind === "number") && String(value).trim()) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`Enter a number for ${field.label || name}.`);
      return [name, number];
    }
    if (field.type === "choice" || field.kind === "yesno") return [name, value === true || value === "yes" || value === "true" || value === "on"];
    return [name, value];
  }));
}
