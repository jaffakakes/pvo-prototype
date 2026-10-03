import { nativeTurnSchema } from "../../../packages/pvo-assistant/native/index.js";

/**
 * Guide tool keys and value types without compiling the canonical contract's
 * large counted string/array repetitions into a provider grammar. The canonical
 * parser still owns every size, numeric range, URL pattern and semantic check.
 */
function generationShape(schema) {
  const shape = {};
  for (const key of ["type", "const", "enum", "required", "additionalProperties"])
    if (key in schema) shape[key] = structuredClone(schema[key]);
  if (schema.properties)
    shape.properties = Object.fromEntries(Object.entries(schema.properties)
      .map(([key, value]) => [key, generationShape(value)]));
  if (schema.anyOf) shape.anyOf = schema.anyOf.map(generationShape);
  if (schema.items) shape.items = generationShape(schema.items);
  return shape;
}

function availableTools(schema, { animation, objectTracking, wordTiming }) {
  return schema.items.anyOf.filter(tool => {
    const kind = tool.properties.kind.const;
    if (kind === "object_tracking" || kind === "animation.follow") return animation && objectTracking;
    if (kind.startsWith("animation.")) return animation;
    if (kind === "word_timing") return wordTiming;
    return true;
  }).map(generationShape);
}

/** Provider guidance only; it never replaces parsing, compilation or policy. */
export function nativeGenerationSchema({ mode = "edit", animation = false, objectTracking = false, wordTiming = false } = {}) {
  const fields = nativeTurnSchema.properties;
  const capabilities = { animation, objectTracking, wordTiming };
  const empty = { type: "array", maxItems: 0, items: { type: "object" } };
  const envelope = properties => ({
    type: "object", additionalProperties: false, required: [...nativeTurnSchema.required],
    properties: { message: generationShape(fields.message), ...properties },
  });
  const tools = field => ({
    type: "array", minItems: 1, maxItems: field.maxItems,
    items: { anyOf: availableTools(field, capabilities) },
  });
  const branches = [];
  if (mode !== "ask") branches.push(envelope({ operations: tools(fields.operations), observations: empty }));
  branches.push(envelope({ operations: empty, observations: tools(fields.observations) }));
  branches.push(envelope({ operations: empty, observations: empty, answer: generationShape(fields.answer) }));
  const blocked = envelope({ operations: empty, observations: empty, blocked: generationShape(fields.blocked) });
  blocked.required.push("blocked");
  branches.push(blocked);
  return { anyOf: branches };
}
