import { canonicalJson } from "../services/json.js";
import { boundedJson, object, requireTask, id } from "../tasks/validation.js";
import {
  parseServiceAgreement,
  matchServicePackage,
  parseServiceTestIdentity,
  parseServiceTestReport,
  SERVICE_TEST_LIMITS,
} from "../services/index.js";
import { parseServiceIdentity, sameServiceIdentity } from "./identity.js";

export const INACTIVE_SERVICE_LIMITS = Object.freeze({
  lifetimeMs: 24 * 60 * 60_000,
  publicationBytes: 2 * 1024 * 1024,
  inputBytes: SERVICE_TEST_LIMITS.invocationBytes,
  outputBytes: SERVICE_TEST_LIMITS.replyBytes,
  probes: 20,
  probeMs: SERVICE_TEST_LIMITS.stepMs,
});

/** Shape validation grants no authority. The task adapter selects its own saved artifact and report. */
export function parseCheckedService(value) {
  object(value, ["artifact", "report"], "Checked service");
  object(
    value.artifact,
    ["agreement", "package", "identity"],
    "Checked service artifact",
  );
  const identity = parseServiceTestIdentity(value.artifact.identity);
  const agreement = parseServiceAgreement(value.artifact.agreement);
  const source = matchServicePackage(
    value.artifact.package,
    identity.agreementDigest,
  );
  const report = parseServiceTestReport(value.report, agreement, identity);
  requireTask(
    report.status === "passed",
    "Only a complete passed platform report can enter hosting.",
  );
  return { artifact: { agreement, package: source, identity }, report };
}

export function parseServicePublication(value) {
  object(value, ["identity", "artifact", "report"], "Service publication");
  const identity = parseServiceIdentity(value.identity);
  const checked = parseCheckedService({
    artifact: value.artifact,
    report: value.report,
  });
  for (const field of ["agreementDigest", "sourceDigest", "packageDigest"])
    requireTask(
      identity[field] === checked.artifact.identity[field],
      "Release identity must bind its checked bytes.",
    );
  boundedJson(
    value,
    INACTIVE_SERVICE_LIMITS.publicationBytes,
    "Service publication",
  );
  return { identity, ...checked };
}

export function parseServiceObservation(value, expected) {
  object(value, ["identity", "state"], "Provider observation");
  const identity = parseServiceIdentity(value.identity);
  requireTask(
    sameServiceIdentity(identity, expected),
    "Provider returned a different owned service.",
  );
  requireTask(
    ["missing", "available", "retained", "deleted"].includes(value.state),
    "Provider state is unsupported.",
  );
  return { identity, state: value.state };
}

export const serializeServicePublication = (value) =>
  canonicalJson(parseServicePublication(value));

export function parseInactiveProbe(value) {
  object(value, ["operation", "input"], "Inactive probe");
  id(value.operation, "Probe operation");
  boundedJson(value, INACTIVE_SERVICE_LIMITS.inputBytes, "Inactive probe");
  return structuredClone(value);
}
