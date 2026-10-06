import {
  boundedJson,
  choice,
  id,
  list,
  object,
  requireTask as requireService,
  text,
  unique,
} from "../tasks/validation.js";
import { SERVICE_PACKAGE_LIMITS as limits } from "./limits.js";
import { boundedValue, serviceName, validateSchema } from "./values.js";
import { validateInvocation, validateReply } from "./operation.js";
import { canonicalJson } from "./json.js";

/** Saved before generation by the trusted task adapter; never a readiness receipt. */
export function parseServiceAgreement(value) {
  object(
    value,
    ["description", "state", "operations", "cases"],
    "Service agreement",
  );
  text(value.description, 2048, "Service description");
  object(value.state, ["schema", "initial"], "State agreement");
  const budget = { nodes: 0 };
  validateSchema(value.state.schema, budget);
  boundedValue(
    value.state.schema,
    value.state.initial,
    limits.stateBytes,
    "Initial service state",
  );
  list(value.operations, limits.operations, "Service operations");
  requireService(value.operations.length > 0, "A service needs operations.");
  for (const operation of value.operations) {
    object(
      operation,
      ["name", "description", "audience", "access", "input", "result"],
      "Service operation",
    );
    serviceName(operation.name, "Operation name");
    text(operation.description, 1024, "Operation description");
    choice(operation.audience, ["public", "creator"], "Operation audience");
    choice(operation.access, ["read", "write"], "Operation storage access");
    validateSchema(operation.input, budget);
    validateSchema(operation.result, budget);
  }
  unique(
    value.operations.map((operation) => operation.name),
    "Operation names",
  );
  list(value.cases, limits.cases, "Behavior cases");
  requireService(
    value.cases.length > 0,
    "A service needs saved behavior cases.",
  );
  const covered = new Set();
  let count = 0;
  for (const scenario of value.cases) {
    object(
      scenario,
      ["id", "description", "initialState", "steps"],
      "Behavior case",
    );
    id(scenario.id, "Behavior case ID");
    text(scenario.description, 1024, "Behavior description");
    boundedValue(
      value.state.schema,
      scenario.initialState,
      limits.stateBytes,
      "Behavior initial state",
    );
    list(scenario.steps, limits.caseSteps, "Behavior steps");
    count += scenario.steps.length;
    requireService(
      scenario.steps.length > 0 && count <= limits.totalSteps,
      "Behavior steps are empty or exceed their total limit.",
    );
    let state = scenario.initialState;
    for (const step of scenario.steps) {
      object(step, ["operation", "input", "now", "expected"], "Behavior step");
      const invocation = {
        operation: step.operation,
        input: step.input,
        state,
        now: step.now,
      };
      validateInvocation(value, invocation);
      validateReply(value, invocation, step.expected);
      covered.add(step.operation);
      state = step.expected.state;
    }
  }
  unique(
    value.cases.map((scenario) => scenario.id),
    "Behavior case IDs",
  );
  requireService(
    value.operations.every((operation) => covered.has(operation.name)),
    "Every operation needs a saved behavior case.",
  );
  boundedJson(value, limits.agreementBytes, "Service agreement");
  return structuredClone(value);
}

export const serializeServiceAgreement = (value) =>
  canonicalJson(parseServiceAgreement(value));

export function parseServiceInvocation(agreement, value) {
  validateInvocation(parseServiceAgreement(agreement), value);
  return structuredClone(value);
}

export function parseServiceReply(agreement, invocation, value) {
  validateReply(parseServiceAgreement(agreement), invocation, value);
  return structuredClone(value);
}
