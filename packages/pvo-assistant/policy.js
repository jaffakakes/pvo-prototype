export class AssistantPolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AssistantPolicyError";
    this.code = code;
    this.part = details.part;
    this.diagnostic = details.diagnostic;
  }
}

function reject(code, message) {
  throw new AssistantPolicyError(code, message);
}

function checkComponent(compiled) {
  if (compiled.js !== "") reject("executable_code", "Assistant proposals cannot contain executable scripts.");
  if (compiled.structure.type === "choice" && compiled.structure.options.length !== 2)
    reject("invalid_component", "Restyle proposals must keep exactly two Choice options.");
}

function checkRoute(action, context) {
  if (action.kind === "continue") return;
  if (action.kind === "time") {
    if (!Number.isFinite(action.t) || action.t < 0 || (context && action.t > context.duration))
      reject("invalid_route", "The proposal jumps outside the selected scene's video.");
    return;
  }
  if (action.kind === "scene") {
    if (context && !context.scenes.some(scene => scene.id === action.sceneId))
      reject("invalid_route", "The proposal links to an empty or missing scene.");
    return;
  }
  if (action.kind === "request") {
    checkRoute(action.onSuccess, context);
    if (action.onError) checkRoute(action.onError, context);
    return;
  }
  reject("unsupported_action", "The proposal contains an unsupported action.");
}

function matchingRule(rules, candidate) {
  return rules.find(rule => rule.event === candidate.event && rule.target === candidate.target);
}

function sameAction(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function usesTypedFormValues(structure) {
  return structure.heading !== undefined || structure.waiting !== undefined
    || structure.fields.some(field => field.label !== undefined || field.kind === "number");
}

/** Input must come from the PVO compiler, never directly from model JSON. */
export function validateCompiledAssistantOriginal(compiled, context) {
  checkComponent(compiled);
  if (context && (!Number.isFinite(context.duration) || context.duration < 0))
    reject("invalid_route", "The selected scene has no valid duration.");
  for (const rule of compiled.rules) checkRoute(rule.action, context);
}

/** Model edits may change playback routes, but never grant or alter host requests. */
export function validateCompiledAssistantProposal(original, proposed, context) {
  validateCompiledAssistantOriginal(proposed, context);
  if (original.structure.type !== proposed.structure.type)
    reject("invalid_component", "The proposal must keep the selected component type.");

  for (const rule of proposed.rules) {
    const before = matchingRule(original.rules, rule);
    if (rule.action.kind === "request" && !sameAction(before?.action, rule.action))
      reject("request_changed", "Configure request actions in the component editor first.");
    if (!context && ["time", "scene"].includes(rule.action.kind) && !sameAction(before?.action, rule.action))
      reject("invalid_route", "Scene context is required to change playback routes.");
  }

  const requests = original.rules.filter(rule => rule.action.kind === "request");
  for (const rule of requests) {
    const after = matchingRule(proposed.rules, rule);
    if (!sameAction(rule.action, after?.action))
      reject("request_changed", "Existing request actions must remain unchanged.");
  }

  // A request may interpolate form state. Renaming/removing fields changes its
  // meaning even if its literal URL and body remain byte-for-byte unchanged.
  if (requests.length && original.structure.type === "form") {
    const before = original.structure.fields;
    const after = proposed.structure.fields;
    if (before.length !== after.length || before.some(field =>
      !after.some(candidate => candidate.name === field.name && candidate.kind === field.kind)))
      reject("request_fields_changed", "Keep request form field names and types unchanged.");
    // Legacy yes/no forms submit strings; labeled forms submit booleans. A copy
    // edit must not change the values interpolated into an existing request.
    if (before.some(field => field.kind === "yesno")
      && usesTypedFormValues(original.structure) !== usesTypedFormValues(proposed.structure))
      reject("request_fields_changed", "Keep existing yes/no form submission types unchanged.");
  }
}
