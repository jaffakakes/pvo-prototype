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

const {
  parseServicePublication,
  parseOwnedRelease,
  parseOwnedService,
  planOwnedPublication,
} = await import("../../packages/pvo-assistant/releases/index.js");
const publication = parseServicePublication({});
const ownedRelease = parseOwnedRelease({});
const ownedService = parseOwnedService({});
ownedRelease.identity.reportDigest = publication.identity.reportDigest;
ownedService.identity.serviceId = publication.identity.serviceId;
// @ts-expect-error Caller data cannot grant release activation.
ownedRelease.state = "live";
// @ts-expect-error Source strings are no longer a publication contract.
publication.source = "export default {}";
// @ts-expect-error An owned release cannot omit its service identity or report digest.
publication.identity = {
  ...identity,
  resourceId: "release",
  ownerId: "owner",
  projectId: "project",
  taskId: "task",
  operationId: "op",
  expiresAt: 1,
};
void planOwnedPublication;

const { parseServiceAction, newHostedService, serviceCallScope } =
  await import("../../packages/pvo-assistant/hosting/index.js");
const serviceAction = parseServiceAction({});
serviceAction.actionId = "retry-this-exact-action";
// @ts-expect-error Request JSON cannot select live authority.
serviceAction.mode = "live";
const hostRecord = newHostedService(publication.identity, 1);
serviceCallScope(hostRecord, {
  kind: "creator",
  ownerId: "owner",
  mode: "test",
});
// @ts-expect-error Public callers have no creator grant.
serviceCallScope(hostRecord, { kind: "public", ownerId: "owner" });

const { parseServiceControl, planServiceControl, parseHostedSummary } =
  await import("../../packages/pvo-assistant/hosting/index.js");
const control = parseServiceControl({});
planServiceControl(hostRecord, control, 2);
parseHostedSummary({});
planServiceControl(
  hostRecord,
  // @ts-expect-error Activation must choose an exact checked release.
  { kind: "activate", actionId: "saved", expectedRevision: 0 },
  2,
);
planServiceControl(
  hostRecord,
  // @ts-expect-error Caller-owned data cannot select a control authority.
  { kind: "pause", actionId: "saved", expectedRevision: 0, ownerId: "foreign" },
  2,
);
