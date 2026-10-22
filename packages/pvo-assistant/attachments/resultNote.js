import { requireTask } from "../tasks/validation.js";

function scalarAt(schema, path) {
  for (const part of path) {
    if (schema?.type === "object")
      schema = schema.fields.find((field) => field.name === part)?.schema;
    else if (
      schema?.type === "array" &&
      /^(0|[1-9]\d*)$/.test(part) &&
      Number(part) < schema.maxItems
    )
      schema = schema.items;
    else return false;
  }
  return schema && !["object", "array"].includes(schema.type);
}

/** A result Note displays only declared public reply fields; it grants no request capability. */
export function validateServiceResultNote(compiled, componentId, operation) {
  requireTask(
    compiled.structure.type === "tooltip" && compiled.rules.length === 0,
    "A connected result Note must display text without actions.",
  );
  const tokens = [
    ...compiled.structure.text.matchAll(/\{(state|response)\.([^}]+)\}/g),
  ];
  requireTask(
    tokens.length > 0,
    "A result Note must display at least one checked response field.",
  );
  const prefix = `responses.${componentId}.`;
  for (const [, root, path] of tokens) {
    requireTask(
      root === "state" && path.startsWith(prefix),
      "A result Note must reference its connected component's response.",
    );
    const parts = path.slice(prefix.length).split(".");
    const background = operation.delivery === "background";
    const label =
      background &&
      parts.length === 2 &&
      parts[0] === "job" &&
      ["label", "status"].includes(parts[1]);
    const resultPath = background ? ["job", "result"] : ["result"];
    requireTask(
      label ||
        (resultPath.every((part, index) => parts[index] === part) &&
          scalarAt(operation.result, parts.slice(resultPath.length))),
      "A result Note must use a declared scalar result field. Use an explicit bounded array index for list entries; objects and arrays cannot render as text.",
    );
  }
}
