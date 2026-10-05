import { parseTaskProposal } from "../tasks/index.js";
import {
  nativeRequestSchema,
  nativeTurnSchema,
  operationSchemas,
} from "./schema.js";
import {
  validateAnimationOperation,
  validateEntityAnimation,
  validateProjectAnimations,
} from "./animation.js";
import { validateTrackingObservation } from "./trackingValidation.js";
export { nativeTurnSchema } from "./schema.js";
export {
  normalizedAlignmentWords,
  parseWordAlignment,
} from "./wordAlignment.js";

const observationRequests =
  nativeTurnSchema.properties.observations.items.anyOf;
const operationKinds = operationSchemas.map(
  (schema) => schema.properties.kind.const,
);
const observationKinds = observationRequests.map(
  (schema) => schema.properties.kind.const,
);

/** Repair guidance uses only the contract's vocabulary, never an unknown model value. */
function rejectToolKind(value, alternatives, path) {
  const operation = alternatives === operationSchemas;
  if (
    (!operation && alternatives !== observationRequests) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return;
  let reason = "is unsupported";
  if (!("kind" in value)) reason = "is required";
  else if (typeof value.kind !== "string") reason = "must be string";
  const kinds = operation ? operationKinds : observationKinds;
  const otherKinds = operation ? observationKinds : operationKinds;
  let guidance = "";
  if (otherKinds.includes(value.kind)) {
    guidance = operation
      ? `${value.kind} is an observation request. Put it in observations with operations:[]; make the edits in a later response after its result.`
      : `${value.kind} is an editing operation. Put it in operations with observations:[]; finish any research first.`;
  }
  throw new Error(
    [
      `${path}.kind ${reason}.`,
      guidance,
      `Allowed ${operation ? "operation" : "observation request"} kinds: ${kinds.join(", ")}.`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** Validate at both the network and editor boundaries; no unrecognized fields survive. */
function validate(value, schema, path) {
  if (schema.anyOf) {
    const alternatives = schema.anyOf;
    const tagged = alternatives.find(
      (item) =>
        typeof item.properties?.kind?.const === "string" &&
        item.properties.kind.const === value?.kind,
    );
    if (tagged) return validate(value, tagged, path);
    rejectToolKind(value, alternatives, path);
    for (const alternative of alternatives) {
      try {
        validate(value, alternative, path);
        return;
      } catch {
        /* Try the remaining explicit shapes. */
      }
    }
    throw new Error(`${path} has an unsupported shape.`);
  }
  if ("const" in schema && value !== schema.const)
    throw new Error(`${path} is invalid.`);
  if (schema.enum && !schema.enum.includes(value))
    throw new Error(`${path} is unsupported.`);
  if (!schema.type) return;
  if (schema.type === "null") {
    if (value !== null) throw new Error(`${path} must be null.`);
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > schema.maxItems)
      throw new Error(`${path} has too many or invalid items.`);
    value.forEach((item, index) =>
      validate(item, schema.items, `${path}[${index}]`),
    );
    return;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${path} must be an object.`);
    if (Object.keys(value).length > (schema.maxProperties ?? 100))
      throw new Error(`${path} has too many fields.`);
    for (const key of schema.required ?? [])
      if (!(key in value)) throw new Error(`${path}.${key} is required.`);
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key] ?? schema.additionalProperties;
      if (
        !child ||
        typeof child !== "object" ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        throw new Error(`${path}.${key} is unsupported.`);
      validate(item, child, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < schema.minimum ||
      value > schema.maximum ||
      (schema.type === "integer" && !Number.isSafeInteger(value))
    )
      throw new Error(`${path} is outside its supported range.`);
    return;
  }
  if (typeof value !== schema.type)
    throw new Error(`${path} must be ${schema.type}.`);
  if (
    schema.type === "string" &&
    (value.length > schema.maxLength ||
      value.length < (schema.minLength ?? 0) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value)))
  )
    throw new Error(`${path} is too long or invalid.`);
}

function validateOperationResponsePolicy(operation) {
  if (
    operation.kind === "component.add" &&
    operation.componentType === "tooltip" &&
    operation.responsePolicy !== undefined
  )
    throw new Error("Display-only Notes cannot define a response policy.");
}

export function parseNativeOperation(value) {
  validate(value, { anyOf: operationSchemas }, "Operation");
  validateOperationResponsePolicy(value);
  validateAnimationOperation(value);
  return structuredClone(value);
}
export function parseNativeObservation(value) {
  validate(
    value,
    nativeRequestSchema.properties.observations.items,
    "Observation",
  );
  validateTrackingObservation(value);
  return structuredClone(value);
}
function entityIdentity(state) {
  return state.kind === "project"
    ? "project"
    : state.kind === "scene"
      ? JSON.stringify([state.kind, state.sceneId])
      : JSON.stringify([state.kind, state.sceneId, state.values.id]);
}
function referenceIdentity(entity) {
  return entity.kind === "project"
    ? "project"
    : entity.kind === "scene"
      ? JSON.stringify([entity.kind, entity.sceneId])
      : JSON.stringify([entity.kind, entity.sceneId, entity.id]);
}
function validateExecution(execution) {
  if (!execution) return;
  if (!execution.receipts.length)
    throw new Error("Execution requires actual preparation receipts.");
  const originals = new Set();
  for (const { entity, state } of execution.requestStartValues) {
    if (state) validateEntityAnimation(state.kind, state.values);
    const key = referenceIdentity(entity);
    if (originals.has(key) || (state && entityIdentity(state) !== key))
      throw new Error(
        "Request-start values must have unique matching entity identities.",
      );
    originals.add(key);
  }
  for (const receipt of execution.receipts) {
    const scheduled =
      receipt.operation.startsWith("playback.") ||
      receipt.operation === "export.prepare";
    if (
      scheduled
        ? receipt.effect?.kind !== receipt.operation
        : receipt.effect !== undefined
    )
      throw new Error(
        "Scheduled receipts require their exact effect; other receipts cannot carry one.",
      );
    if (
      receipt.outcome !==
      (scheduled
        ? "scheduled"
        : receipt.changes.length
          ? "prepared"
          : "unchanged")
    )
      throw new Error(
        "Receipt outcome must match actual preparation changes or scheduled effects.",
      );
    if (receipt.target && !originals.has(referenceIdentity(receipt.target)))
      throw new Error("Receipt targets require request-start values.");
    for (const { before, after } of receipt.changes) {
      if (before) validateEntityAnimation(before.kind, before.values);
      if (after) validateEntityAnimation(after.kind, after.values);
      if (
        (!before && !after) ||
        (before && after && entityIdentity(before) !== entityIdentity(after))
      )
        throw new Error(
          "Receipt before and after values must describe the same entity.",
        );
      if (!originals.has(entityIdentity(after ?? before)))
        throw new Error("Changed entities require request-start values.");
    }
  }
}

export function parseNativeTurnRequest(value) {
  if (JSON.stringify(value)?.length > 6_000_000)
    throw new Error("Assistant request is too large.");
  validate(value, nativeRequestSchema, "Request");
  validateProjectAnimations(value.project);
  value.observations.forEach(validateTrackingObservation);
  const trackIds = value.observations
    .filter((item) => item.kind === "object_tracking")
    .map((item) => item.id);
  if (new Set(trackIds).size !== trackIds.length)
    throw new Error("Object-tracking evidence IDs must be unique.");
  validateExecution(value.execution);
  for (const scene of value.project.scenes)
    for (const component of scene.components) {
      if (
        component.type === "tooltip" &&
        component.responsePolicy !== undefined
      )
        throw new Error("Display-only Notes cannot define a response policy.");
      if (
        component.type !== "tooltip" &&
        component.responsePolicy === undefined
      )
        throw new Error(
          "Interactive component context requires a response policy.",
        );
    }
  return structuredClone(value);
}
export function parseNativeTurnResult(value) {
  validate(value, nativeTurnSchema, "Response");
  if (value.cloudTask !== undefined) {
    parseTaskProposal(value.cloudTask);
    if (
      value.blocked ||
      value.answer !== undefined ||
      value.operations.length ||
      value.observations.length
    )
      throw new Error(
        "A saved task proposal cannot be mixed with native edits, observations, an answer or a blocker.",
      );
  }
  value.operations.forEach(validateOperationResponsePolicy);
  value.operations.forEach(validateAnimationOperation);
  if (value.blocked && (value.operations.length || value.observations.length))
    throw new Error(
      "A blocked response cannot contain operations or observation requests.",
    );
  if (
    value.answer !== undefined &&
    (!value.answer.trim() ||
      value.blocked ||
      value.operations.length ||
      value.observations.length)
  )
    throw new Error(
      "A substantive answer requires an unblocked terminal response with no operations or observation requests.",
    );
  if (
    value.evidence &&
    (value.evidence.some((item) => !item.trim()) ||
      value.evidence.reduce((total, item) => total + item.length, 0) > 8000)
  )
    throw new Error("Response evidence is blank or exceeds its text limit.");
  for (const observation of value.observations) {
    if (observation.end < observation.start)
      throw new Error("Observation end precedes its start.");
  }
  return structuredClone(value);
}

export {
  TRACKING_MAX_SECONDS,
  TRACKING_FPS,
  TRACKING_MAX_FRAMES,
  TRACKING_MAX_EDGE,
  TRACKING_MAX_FRAME_BYTES,
  TRACKING_MAX_REQUEST_BYTES,
  objectTrackingTimes,
  parseObjectTrackingResult,
} from "./objectTracking.js";
