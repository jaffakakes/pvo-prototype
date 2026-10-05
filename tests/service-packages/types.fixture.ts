import {
  parseServiceAgreement,
  parseServiceInvocation,
  parseServiceReply,
  parseServicePackage,
  SERVICE_RUNTIME,
  type ServiceAgreement,
  type ServiceExecute,
  type ServicePackage,
  type ServiceValueSchema,
} from "../../packages/pvo-assistant/services/index.js";

const agreement: ServiceAgreement = parseServiceAgreement({});
const call = parseServiceInvocation(agreement, {});
const execute: ServiceExecute = async ({ state }) => ({
  result: "accepted",
  state,
});
const result = parseServiceReply(agreement, call, await execute(call));
const source: ServicePackage = parseServicePackage({});
source.runtime = SERVICE_RUNTIME;
const schema: ServiceValueSchema = {
  type: "array",
  maxItems: 5,
  items: { type: "null" },
};
// @ts-expect-error Runtime requires the platform-supported target.
source.runtime = "unrestricted-node";
// @ts-expect-error The initial package lock admits no external dependencies.
source.dependencies = [{ name: "anything", version: "latest" }];
// @ts-expect-error Test claims are not a source-package capability.
source.passed = true;
const executable: ServiceValueSchema = {
  // @ts-expect-error Data descriptions cannot execute a custom validator.
  type: "function",
  code: "return true",
};
// @ts-expect-error A service must propose state alongside its result.
const incomplete: ServiceExecute = () => ({ result: null });
void result;
void schema;
void executable;
void incomplete;

const {
  newServiceTestReport,
  appendServiceCaseResult,
  parseServiceTestReport,
} = await import("../../packages/pvo-assistant/services/index.js");
const identity = {
  agreementDigest: "a".repeat(64),
  packageDigest: "b".repeat(64),
  sourceDigest: "c".repeat(64),
};
let report = newServiceTestReport(agreement, identity);
report = appendServiceCaseResult(report, agreement, identity, {
  id: "case",
  status: "passed",
  completedSteps: 1,
  failure: null,
});
parseServiceTestReport(report, agreement, identity);
// @ts-expect-error A report has no deployment authority or live URL.
report.liveUrl = "https://example.com";
// @ts-expect-error Every test identity must include the exact package digest.
newServiceTestReport(agreement, {
  agreementDigest: identity.agreementDigest,
  sourceDigest: identity.sourceDigest,
});
