const PARTS = ["structure", "style", "logic"];
const encoder = new TextEncoder();

export const ASSISTANT_SOURCE_MAX_BYTES = 20000;
export const ASSISTANT_MAX_SCENES = 100;

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object.`);
  return value;
}

function onlyKeys(value, keys, label) {
  if (Object.keys(value).some(key => !keys.includes(key)))
    throw new TypeError(`${label} contains unsupported fields.`);
}

function text(value, maximum, label) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new TypeError(`${label} must be text between 1 and ${maximum} characters.`);
  return value.trim();
}

function source(value) {
  const input = record(value, "PVO source");
  onlyKeys(input, PARTS, "PVO source");
  for (const part of PARTS) {
    if (typeof input[part] !== "string" || encoder.encode(input[part]).byteLength > ASSISTANT_SOURCE_MAX_BYTES)
      throw new TypeError(`PVO ${part} must be text of at most ${ASSISTANT_SOURCE_MAX_BYTES} UTF-8 bytes.`);
  }
  return { structure: input.structure, style: input.style, logic: input.logic };
}

function context(value) {
  const input = record(value, "Assistant context");
  onlyKeys(input, ["currentSceneId", "duration", "scenes"], "Assistant context");
  const currentSceneId = text(input.currentSceneId, 128, "Current scene ID");
  if (typeof input.duration !== "number" || !Number.isFinite(input.duration) || input.duration < 0)
    throw new TypeError("Scene duration must be a finite, nonnegative number.");
  if (!Array.isArray(input.scenes) || input.scenes.length > ASSISTANT_MAX_SCENES)
    throw new TypeError(`Assistant context must contain at most ${ASSISTANT_MAX_SCENES} scenes.`);
  const scenes = input.scenes.map(value => {
    const scene = record(value, "Assistant scene");
    onlyKeys(scene, ["id", "name"], "Assistant scene");
    return { id: text(scene.id, 128, "Scene ID"), name: text(scene.name, 120, "Scene name") };
  });
  const ids = new Set(scenes.map(scene => scene.id));
  if (ids.size !== scenes.length || !ids.has(currentSceneId))
    throw new TypeError("Assistant scenes must have unique IDs and include the current scene.");
  return { currentSceneId, duration: input.duration, scenes };
}

/** Parse the shared HTTP request without compiling or interpreting PVO source. */
export function parseAssistantRequest(value) {
  const input = record(value, "Assistant request");
  onlyKeys(input, ["componentType", "source", "prompt", "context", "editingMode"], "Assistant request");
  if (Object.hasOwn(input, "editingMode") && !["no-code", "advanced"].includes(input.editingMode))
    throw new TypeError("Assistant editing mode must be no-code or advanced.");
  if (!["tooltip", "card", "choice", "form"].includes(input.componentType))
    throw new TypeError("Choose a supported PVO component before asking for a proposal.");
  return {
    componentType: input.componentType,
    source: source(input.source),
    prompt: text(input.prompt, 2000, "Assistant prompt"),
    ...(Object.hasOwn(input, "editingMode") ? { editingMode: input.editingMode } : {}),
    ...(Object.hasOwn(input, "context") ? { context: context(input.context) } : {}),
  };
}

/** Parse a complete proposal; generated HTML, JavaScript and extra fields are rejected. */
export function parseAssistantResponse(value) {
  const input = record(value, "Assistant response");
  onlyKeys(input, ["source", "summary", "tags", "followUps", "requiresAdvancedLogic"], "Assistant response");
  if (Object.hasOwn(input, "requiresAdvancedLogic") && typeof input.requiresAdvancedLogic !== "boolean")
    throw new TypeError("requiresAdvancedLogic must be a boolean.");
  if (!Array.isArray(input.tags) || input.tags.length > 6)
    throw new TypeError("Assistant tags must be a list of at most six short labels.");
  if (!Array.isArray(input.followUps) || input.followUps.length !== 3)
    throw new TypeError("Assistant responses must include exactly three follow-up suggestions.");
  return {
    source: source(input.source),
    summary: text(input.summary, 400, "Proposal summary"),
    ...(Object.hasOwn(input, "requiresAdvancedLogic") ? { requiresAdvancedLogic: input.requiresAdvancedLogic } : {}),
    tags: input.tags.map(value => text(value, 40, "Proposal tag")),
    followUps: input.followUps.map(value => text(value, 120, "Follow-up suggestion")),
  };
}

// JSON Schema supports model structured output; the parser also checks UTF-8 byte limits.
export const assistantResponseSchema = {
  type: "object", additionalProperties: false,
  required: ["source", "summary", "tags", "followUps"],
  properties: {
    requiresAdvancedLogic: { type: "boolean" },
    source: {
      type: "object", additionalProperties: false, required: [...PARTS],
      properties: Object.fromEntries(PARTS.map(part => [part, { type: "string", maxLength: ASSISTANT_SOURCE_MAX_BYTES }])),
    },
    summary: { type: "string", minLength: 1, maxLength: 400 },
    tags: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 40 } },
    followUps: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", minLength: 1, maxLength: 120 } },
  },
};
