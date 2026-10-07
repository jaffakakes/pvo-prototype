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
// @ts-expect-error A library lock requires retained bytes and registry integrity.
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

const { parseServiceState } =
  await import("../../packages/pvo-assistant/services/index.js");
const { prepareReleaseActivation } =
  await import("../../packages/pvo-assistant/hosting/index.js");
parseServiceState(agreement, agreement.state.initial);
prepareReleaseActivation(agreement, agreement, agreement.state.initial);

const attachments =
  await import("../../packages/pvo-assistant/attachments/index.js");
const attachment = attachments.parseServiceAttachmentCommand({});
const attachmentReceipt = attachments.parseServiceAttachmentReceipt({});
const verifiedAttachment = attachments.matchServiceAttachment(
  attachment,
  attachmentReceipt,
  { ownerId: "owner", projectId: "project", taskId: "task" },
  0,
);
const publicAudience: "public" = verifiedAttachment.receipt.operation.audience;
// @ts-expect-error A model proposal cannot supply an address.
attachment.connection.url = "https://invented.example";
// @ts-expect-error A source-changing native operation cannot receive readiness authority.
attachment.component.receipt = attachmentReceipt;
// @ts-expect-error Input bindings cannot execute expressions.
attachment.connection.input = { kind: "expression", code: "run()" };
void publicAudience;

const attachmentAuthorization = {
  ...verifiedAttachment,
  scope: { ownerId: "owner", projectId: "project", taskId: "task" },
  now: 0,
  origin: "https://restyle.example",
};
const checkedRequest = attachments.serviceAttachmentRequest(
  attachmentAuthorization,
);
const postMethod: "POST" = checkedRequest.method;
attachments.matchAttachmentOperation(
  attachment.component,
  attachmentAuthorization,
);
// @ts-expect-error A proposed component alone supplies no independent service receipt or scope.
attachments.serviceAttachmentRequest(attachment);
void postMethod;

const componentConnection = attachments.prepareComponentServiceConnection(
  attachmentAuthorization,
);
const checkedConnection: import("../../packages/pvo-assistant/attachments/index.js").ComponentServiceConnection =
  attachments.parseComponentServiceConnection(componentConnection);
// @ts-expect-error Saved component metadata grants no live/test namespace selector.
checkedConnection.mode = "live";
void checkedConnection;

const submissionTarget = attachments.prepareServiceSubmissionTarget(
  checkedConnection,
  { mode: "public", ownerId: null },
);
const submissionInput = attachments.resolveServiceSubmissionInput(
  checkedConnection,
  { guest: "Alice" },
);
const submission = attachments.prepareServiceSubmission(
  submissionTarget,
  submissionInput,
  "opaque-action-id",
);
const restoredSubmission = attachments.retryServiceSubmission(
  JSON.parse(JSON.stringify(submission)),
  submissionTarget,
);
const submissionRequest =
  attachments.serviceSubmissionRequest(restoredSubmission);
const submissionMethod: "POST" = submissionRequest.method;
attachments.completeServiceSubmission(restoredSubmission, {
  actionId: "opaque-action-id",
  result: "accepted",
});
// @ts-expect-error Public replay scopes cannot retain a creator account.
attachments.prepareServiceSubmissionTarget(checkedConnection, {
  mode: "public",
  ownerId: "creator",
});
// @ts-expect-error Try requires the current creator identity.
attachments.prepareServiceSubmissionTarget(checkedConnection, {
  mode: "try",
  ownerId: null,
});
// @ts-expect-error The client checkpoint has no caller-controlled permission flag.
submission.permission = "granted";
void submissionMethod;

const submissionStore = await attachments.openServiceSubmissionStore();
const submissionClient = attachments.createServiceSubmissionClient({
  store: submissionStore,
  createId: () => crypto.randomUUID(),
  send: async () => ({ actionId: "saved", result: "accepted" }),
});
submissionClient.submit("component-slot", submissionTarget, submissionInput, {
  isCurrent: () => true,
});
submissionClient.retry("component-slot", submissionTarget, {
  isCurrent: () => true,
  signal: new AbortController().signal,
});
// @ts-expect-error The host must supply a current-context fence.
submissionClient.retry("component-slot", submissionTarget, {});
submissionStore.close();

serviceCallScope(hostRecord, {
  kind: "component_test",
  ownerId: "owner",
  releaseId: "release-one",
});
serviceCallScope(hostRecord, {
  kind: "component_test",
  ownerId: "owner",
  releaseId: "release-one",
  // @ts-expect-error A component test cannot select the live namespace.
  mode: "live",
});

const publicConnection =
  attachments.projectPublicServiceConnection(componentConnection);
const restoredPublicConnection =
  attachments.parsePublicServiceConnection(publicConnection);
const publicTarget = attachments.publicServiceSubmissionTarget(
  restoredPublicConnection,
);
const publicMode: "public" = publicTarget.mode;
const anonymousOwner: null = publicTarget.ownerId;
attachments.resolvePublicServiceSubmissionInput(restoredPublicConnection, {
  guest: "Alice",
});
attachments.matchesPublicServiceRequest(restoredPublicConnection, {
  url: "https://restyle.example/action",
  method: "POST",
  body: "{}",
});
// @ts-expect-error Private authoring receipts cannot be read from the public description.
publicConnection.receipt;
void publicMode;
void anonymousOwner;
