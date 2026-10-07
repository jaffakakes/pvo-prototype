import {
  object,
  digest,
  choice,
  integer,
  list,
  text,
  requireTask,
  boundedJson,
} from "../tasks/validation.js";
import { parseServiceAgreement, parseServiceReply } from "./agreement.js";
import { canonicalJson } from "./json.js";

export const SERVICE_TEST_POLICY = "restyle-service-checks-v1";
export const SERVICE_TEST_LIMITS = Object.freeze({
  cpuMs: 50,
  invocationMs: 2000,
  stepMs: 55000,
  invocationBytes: 64 * 1024,
  replyBytes: 64 * 1024,
  reportBytes: 48 * 1024,
});
const failures = [
  "invalid_reply",
  "execution_failed",
  "output_limit",
  "timeout",
  "mismatch",
  "interrupted",
];

/** These identifiers are computed by trusted code from the immutable saved bytes. */
export function parseServiceTestIdentity(value) {
  object(
    value,
    ["agreementDigest", "packageDigest", "sourceDigest"],
    "Service test identity",
  );
  for (const key of Object.keys(value)) digest(value[key], key);
  return structuredClone(value);
}

export function parseServiceCaseResult(value, scenario) {
  object(
    value,
    ["id", "status", "completedSteps", "failure"],
    "Behavior case result",
  );
  requireTask(
    value.id === scenario.id,
    "Behavior result belongs to a different case.",
  );
  choice(value.status, ["passed", "failed", "interrupted"], "Case status");
  integer(value.completedSteps, scenario.steps.length, "Completed case steps");
  if (value.status === "passed")
    requireTask(
      value.completedSteps === scenario.steps.length && value.failure === null,
      "A case passes only after every step.",
    );
  else {
    object(value.failure, ["step", "code", "detail"], "Case failure");
    integer(value.failure.step, scenario.steps.length - 1, "Failed step");
    choice(value.failure.code, failures, "Case failure code");
    text(value.failure.detail, 2048, "Case failure detail");
    requireTask(
      value.completedSteps === value.failure.step,
      "Case failure must identify its first incomplete step.",
    );
    requireTask(
      (value.status === "interrupted") ===
        (value.failure.code === "interrupted"),
      "Interrupted execution cannot be a completed test.",
    );
  }
  return structuredClone(value);
}

/** Shape validation is not authorization: only the trusted runner may save these reports. */
export function parseServiceTestReport(value, agreement, identity) {
  agreement = parseServiceAgreement(agreement);
  identity = parseServiceTestIdentity(identity);
  object(
    value,
    ["policy", "identity", "status", "cases"],
    "Service test report",
  );
  requireTask(
    value.policy === SERVICE_TEST_POLICY,
    "Unsupported service test policy.",
  );
  requireTask(
    canonicalJson(parseServiceTestIdentity(value.identity)) ===
      canonicalJson(identity),
    "Test report belongs to different saved bytes.",
  );
  choice(
    value.status,
    ["running", "passed", "failed", "interrupted"],
    "Test status",
  );
  list(value.cases, agreement.cases.length, "Tested cases");
  for (let index = 0; index < value.cases.length; index++) {
    parseServiceCaseResult(value.cases[index], agreement.cases[index]);
    if (index < value.cases.length - 1)
      requireTask(
        value.cases[index].status === "passed",
        "Testing stops at the first unfinished case.",
      );
  }
  const last = value.cases.at(-1);
  const expected =
    last && last.status !== "passed"
      ? last.status
      : value.cases.length === agreement.cases.length
        ? "passed"
        : "running";
  requireTask(
    value.status === expected,
    "A missing or failed case cannot pass the test gate.",
  );
  boundedJson(value, SERVICE_TEST_LIMITS.reportBytes, "Service test report");
  return structuredClone(value);
}
export const serializeServiceTestReport = (value, agreement, identity) =>
  canonicalJson(parseServiceTestReport(value, agreement, identity));

export function newServiceTestReport(agreement, identity) {
  return parseServiceTestReport(
    { policy: SERVICE_TEST_POLICY, identity, status: "running", cases: [] },
    agreement,
    identity,
  );
}
export function appendServiceCaseResult(report, agreement, identity, result) {
  report = parseServiceTestReport(report, agreement, identity);
  requireTask(
    report.status === "running",
    "A completed test report is immutable.",
  );
  const cases = [...report.cases, result];
  const status =
    result.status !== "passed"
      ? result.status
      : cases.length === agreement.cases.length
        ? "passed"
        : "running";
  return parseServiceTestReport(
    { ...report, status, cases },
    agreement,
    identity,
  );
}

function excerpt(value) {
  return JSON.stringify(value).slice(0, 120);
}
function difference(expected, actual, path) {
  if (canonicalJson(expected) === canonicalJson(actual)) return null;
  if (
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object" &&
    Array.isArray(expected) === Array.isArray(actual)
  ) {
    for (const key of new Set([
      ...Object.keys(expected),
      ...Object.keys(actual),
    ])) {
      if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key))
        return `${path}.${key}: field presence differs.`;
      const found = difference(expected[key], actual[key], `${path}.${key}`);
      if (found) return found;
    }
  }
  return `${path}: expected ${excerpt(expected)}, received ${excerpt(actual)}.`;
}

/** Comparison runs outside generated code. The returned diagnostic is bounded and contains no success authority. */
export function inspectServiceReply(agreement, invocation, expected, actual) {
  try {
    parseServiceReply(agreement, invocation, actual);
  } catch {
    return {
      code: "invalid_reply",
      detail:
        "Returned data violates the saved result/state schema or a read-only operation changed state.",
    };
  }
  const detail = difference(expected, actual, "reply");
  return detail ? { code: "mismatch", detail: detail.slice(0, 512) } : null;
}
