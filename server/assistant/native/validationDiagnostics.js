import { nativeTurnSchema } from "../../../packages/pvo-assistant/native/index.js";
import { assistantServiceErrorDefinition } from "../../../packages/pvo-assistant/service-errors.js";

const STAGES = new Set(["decode", "schema", "policy", "repair", "review"]);
const STATUSES = new Set(["started", "completed", "failed"]);
const PHASES = new Set(["initial", "repair", "review"]);
const FINISH_REASONS = new Set(["stop", "length", "tool_calls", "content_filter", "function_call", "max_tokens", "end_turn", "eos", "stop_sequence"]);
const POLICY_CODES = new Set(["executable_code", "invalid_component", "invalid_route", "unsupported_action", "request_changed", "request_fields_changed", "advanced_required"]);
const schemaPaths = new Set();
const operationKinds = new Set(nativeTurnSchema.properties.operations.items.anyOf.map(item => item.properties.kind.const));
const observationKinds = new Set(nativeTurnSchema.properties.observations.items.anyOf.map(item => item.properties.kind.const));

function collectPaths(schema, path = "$") {
  schemaPaths.add(path);
  for (const alternative of schema.anyOf ?? []) collectPaths(alternative, path);
  for (const [key, child] of Object.entries(schema.properties ?? {})) collectPaths(child, `${path}.${key}`);
  if (schema.items) collectPaths(schema.items, `${path}[]`);
}
collectPaths(nativeTurnSchema);

// Data properties only: diagnostics must not invoke model-owned getters or toJSON.
function ownValue(value, key) {
  if (!value || typeof value !== "object") return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function boundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, maximum) : null;
}

function attemptedKinds(response, field, allowed, maximum) {
  const items = ownValue(response, field);
  if (!Array.isArray(items)) return { count: items === undefined ? 0 : null, kinds: [] };
  const kinds = new Set();
  for (let index = 0; index < Math.min(items.length, maximum); index++) {
    const kind = ownValue(ownValue(items, String(index)), "kind");
    kinds.add(allowed.has(kind) ? kind : "unknown");
  }
  return { count: Math.min(items.length, maximum + 1), kinds: [...kinds] };
}

const schemaRules = new Map([
  ["has an unsupported shape", "union_shape"], ["is invalid", "constant"],
  ["is unsupported", "unsupported_value_or_field"], ["must be null", "null_type"],
  ["has too many or invalid items", "array_type_or_limit"], ["must be an object", "object_type"],
  ["has too many fields", "object_field_limit"], ["is required", "required_field"],
  ["is outside its supported range", "number_type_or_range"], ["must be string", "string_type"],
  ["must be boolean", "boolean_type"], ["is too long or invalid", "string_format_or_limit"],
]);
const schemaMessage = /^(Response|Operation|Observation)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d{1,8}\]){0,16}) (has an unsupported shape|is invalid|is unsupported|must be null|has too many or invalid items|must be an object|has too many fields|is required|is outside its supported range|must be string|must be boolean|is too long or invalid)\.$/;
const roots = { Response: "$", Operation: "$.operations[]", Observation: "$.observations[]" };

function schemaFailure(message) {
  const match = schemaMessage.exec(message);
  if (!match) return null;
  let path = roots[match[1]];
  const tokens = match[2].replace(/\[\d+\]/g, "[]").match(/\.[A-Za-z_][A-Za-z0-9_]*|\[\]/g) ?? [];
  for (const token of tokens) {
    if (!schemaPaths.has(path + token)) return { schemaPath: `${path}.*`, rule: "unknown_field" };
    path += token;
  }
  return { schemaPath: path, rule: schemaRules.get(match[3]) };
}

// Exact known diagnostics become stable IDs. Anything new stays generic until
// explicitly reviewed; exception messages can embed private source or model keys.
const validationRules = new Map([
  ["Return the native editor JSON result, without separate tool calls.", "response_envelope"],
  ["The response is too large.", "response_size_limit"],
  ["Evidence is added by the server. Return only message, operations, observations and the optional blocked or answer fields.", "server_evidence_only"],
  ["Layer animation is unavailable in this editor session. Use only available operations.", "animation_unavailable"],
  ["Object tracking is unavailable in this editor session. Use only available operations.", "tracking_unavailable"],
  ["Word timing is unavailable on this server. Use the available observations.", "word_timing_unavailable"],
  ["A blocked response cannot contain operations or observation requests.", "blocked_mixed_payload"],
  ["A substantive answer requires an unblocked terminal response with no operations or observation requests.", "answer_requires_terminal_response"],
  ["Response evidence is blank or exceeds its text limit.", "evidence_text_limit"],
  ["Observation end precedes its start.", "observation_time_order"],
  ["Display-only Notes cannot define a response policy.", "display_only_response_policy"],
  ["The animation property is unsupported by this layer.", "animation_property_target"],
  ["Set at least one animation track.", "animation_tracks_required"],
  ["Choose an existing scene ID.", "scene_id_missing"],
  ["Choose a range within the scene duration.", "scene_range"],
  ["Provide a concise user-facing message.", "message_required"],
  ["Ask mode cannot return editing or playback operations.", "ask_mode_operations"],
  ["Inspect footage before returning operations; do not combine both in one turn.", "mixed_operations_observations"],
  ["Choose a nonempty observation range.", "observation_range_empty"],
  ["Request at most 60 seconds of transcription per observation.", "transcription_duration_limit"],
  ["Request no more than six sampled frames in one turn.", "frame_count_limit"],
  ["Seek within the existing scene duration.", "seek_range"],
  ["This component has no validated design to restyle.", "component_design_missing"],
  ["This component source is unavailable. Use component.content to preserve its existing behavior.", "component_source_missing"],
  ["Configure new network requests in the component editor first.", "new_network_request"],
]);
const creationAdvice = " This reply includes creation operations, but none execute inside the reply. Return ONLY the creation operations and independent operations using existing IDs now. Remove follow-ups targeting newly created objects. The next turn will supply their actual generated IDs; use those IDs then.";
for (const kind of ["clip", "audio", "text", "component"]) {
  const message = `Choose an existing ${kind} ID from the supplied project. Never guess a newly created object's ID.`;
  validationRules.set(message, `${kind}_id_missing`);
  validationRules.set(message + creationAdvice, "new_entity_id_unavailable");
}

function validationFailure(error) {
  if (error instanceof SyntaxError) return { schemaPath: null, rule: "json_syntax" };
  const part = ownValue(error, "part");
  if (ownValue(error, "name") === "PvoLanguageError" && ["structure", "style", "logic"].includes(part))
    return { schemaPath: null, rule: `compiler_${part}` };
  const code = ownValue(error, "code");
  if (POLICY_CODES.has(code)) return { schemaPath: null, rule: `policy_${code}` };
  const message = ownValue(error, "message");
  if (typeof message === "string" && message.length <= 1024) {
    const schema = schemaFailure(message);
    if (schema) return schema;
    if (validationRules.has(message)) return { schemaPath: null, rule: validationRules.get(message) };
  }
  return { schemaPath: null, rule: "validation_failed" };
}

/** Returns only fixed vocabulary, canonical schema paths and bounded counts. */
export function nativeValidationDiagnostic(input) {
  const stage = ownValue(input, "stage");
  if (!STAGES.has(stage)) return null;
  const status = ownValue(input, "status") ?? "failed";
  if (!STATUSES.has(status)) return null;
  const error = ownValue(input, "error");
  const response = ownValue(input, "response");
  const operations = attemptedKinds(response, "operations", operationKinds, 24);
  const observations = attemptedKinds(response, "observations", observationKinds, 4);
  const phase = ownValue(input, "phase");
  const reason = ownValue(input, "finishReason");
  const classification = assistantServiceErrorDefinition(ownValue(input, "failureCode"))
    ?? assistantServiceErrorDefinition(ownValue(error, "code"));
  return {
    operation: "native-assistant-validation", stage, status,
    attempt: boundedInteger(ownValue(input, "attempt"), 3),
    phase: PHASES.has(phase) ? phase : "initial",
    classification: classification?.code ?? (status === "failed" ? "validation_failed" : null),
    finishReason: FINISH_REASONS.has(reason) ? reason : "unknown",
    ...(status === "failed" ? validationFailure(error) : { schemaPath: null, rule: null }),
    operationCount: operations.count, operationKinds: operations.kinds,
    observationCount: observations.count, observationKinds: observations.kinds,
  };
}

/** Logging is best-effort and capped per request; it cannot fail an editor turn. */
export function createNativeValidationTrace({ write = event => console.warn(JSON.stringify(event)) } = {}) {
  let entries = 0;
  return input => {
    if (entries >= 12) return;
    try {
      const event = nativeValidationDiagnostic(input);
      if (!event) return;
      entries++;
      write(event);
    } catch { /* Diagnostics must never replace the original operation outcome. */ }
  };
}
