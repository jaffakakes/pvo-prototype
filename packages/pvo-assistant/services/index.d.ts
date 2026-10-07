export type ServiceJson =
  | null
  | boolean
  | number
  | string
  | ServiceJson[]
  | { [key: string]: ServiceJson };
export type ServiceValueSchema =
  | { type: "null" | "boolean" }
  | { type: "string"; maxBytes: number }
  | { type: "number" | "integer"; minimum: number; maximum: number }
  | { type: "enum"; values: string[] }
  | { type: "array"; maxItems: number; items: ServiceValueSchema }
  | {
      type: "object";
      fields: {
        name: string;
        description: string;
        schema: ServiceValueSchema;
      }[];
    };
export type ServiceOperation = {
  name: string;
  description: string;
  audience: "public" | "creator";
  access: "read" | "write";
  input: ServiceValueSchema;
  result: ServiceValueSchema;
};
export type ServiceInvocation = {
  operation: string;
  input: ServiceJson;
  state: ServiceJson;
  now: number;
};
export type ServiceReply = { result: ServiceJson; state: ServiceJson };
export type ServiceBehaviorCase = {
  id: string;
  description: string;
  initialState: ServiceJson;
  steps: {
    operation: string;
    input: ServiceJson;
    now: number;
    expected: ServiceReply;
  }[];
};
export type ServiceAgreement = {
  description: string;
  state: { schema: ServiceValueSchema; initial: ServiceJson };
  operations: ServiceOperation[];
  cases: ServiceBehaviorCase[];
};
export type ServiceSourceFile = { path: string; content: string };
export type ServicePackage = {
  agreementDigest: string;
  runtime: "cloudflare-workers-esm";
  entrypoint: string;
  dependencies: [];
  files: ServiceSourceFile[];
  tests: string[];
};
export type ServiceExecute = (
  invocation: ServiceInvocation,
) => ServiceReply | Promise<ServiceReply>;
export const SERVICE_RUNTIME: "cloudflare-workers-esm";
export const SERVICE_PACKAGE_LIMITS: Readonly<{
  operations: number;
  cases: number;
  caseSteps: number;
  totalSteps: number;
  schemaNodes: number;
  schemaDepth: number;
  fields: number;
  arrayItems: number;
  stringBytes: number;
  inputBytes: number;
  resultBytes: number;
  stateBytes: number;
  envelopeBytes: number;
  agreementBytes: number;
  files: number;
  fileBytes: number;
  packageBytes: number;
  tests: number;
}>;
export function parseServiceAgreement(value: unknown): ServiceAgreement;
export function serializeServiceAgreement(value: unknown): string;
export function parseServiceInvocation(
  agreement: unknown,
  value: unknown,
): ServiceInvocation;
export function parseServiceReply(
  agreement: unknown,
  invocation: unknown,
  value: unknown,
): ServiceReply;
export function parseServiceFilePath(value: unknown): string;
export function parseServiceFiles(value: unknown): ServiceSourceFile[];
export function serializeServiceFiles(value: unknown): string;
export function parseServicePackage(value: unknown): ServicePackage;
export function serializeServicePackage(value: unknown): string;
export function matchServicePackage(
  value: unknown,
  expectedAgreementDigest: string,
): ServicePackage;

export const SERVICE_TEST_POLICY: "restyle-service-checks-v1";
export const SERVICE_TEST_LIMITS: Readonly<{
  cpuMs: number;
  invocationMs: number;
  stepMs: number;
  invocationBytes: number;
  replyBytes: number;
  reportBytes: number;
}>;
export type ServiceTestIdentity = {
  agreementDigest: string;
  packageDigest: string;
  sourceDigest: string;
};
export type ServiceTestFailure = {
  step: number;
  code:
    | "invalid_reply"
    | "execution_failed"
    | "output_limit"
    | "timeout"
    | "mismatch"
    | "interrupted";
  detail: string;
};
export type ServiceCaseResult = {
  id: string;
  status: "passed" | "failed" | "interrupted";
  completedSteps: number;
  failure: ServiceTestFailure | null;
};
export type ServiceTestReport = {
  policy: typeof SERVICE_TEST_POLICY;
  identity: ServiceTestIdentity;
  status: "running" | "passed" | "failed" | "interrupted";
  cases: ServiceCaseResult[];
};
export function parseServiceTestIdentity(value: unknown): ServiceTestIdentity;
export function parseServiceCaseResult(
  value: unknown,
  scenario: ServiceAgreement["cases"][number],
): ServiceCaseResult;
export function parseServiceTestReport(
  value: unknown,
  agreement: ServiceAgreement,
  identity: ServiceTestIdentity,
): ServiceTestReport;
export function serializeServiceTestReport(
  value: unknown,
  agreement: ServiceAgreement,
  identity: ServiceTestIdentity,
): string;
export function newServiceTestReport(
  agreement: ServiceAgreement,
  identity: ServiceTestIdentity,
): ServiceTestReport;
export function appendServiceCaseResult(
  report: ServiceTestReport,
  agreement: ServiceAgreement,
  identity: ServiceTestIdentity,
  result: ServiceCaseResult,
): ServiceTestReport;
export function inspectServiceReply(
  agreement: ServiceAgreement,
  invocation: ServiceInvocation,
  expected: ServiceReply,
  actual: unknown,
): { code: "invalid_reply" | "mismatch"; detail: string } | null;

export function parseServiceState(
  agreement: ServiceAgreement,
  value: unknown,
): ServiceJson;

export function parseServiceOperation(value: unknown): ServiceOperation;

export type ServiceDraftContent = {
  description: string;
  agreement: ServiceAgreement | null;
  entrypoint: string;
  files: ServiceSourceFile[];
  tests: string[];
  dependencies: [];
};
export type ServiceDraft = {
  identity: { serviceId: string; ownerId: string; projectId: string };
  revision: number;
  content: ServiceDraftContent;
  updatedAt: number;
};
export type ServiceDraftSave = {
  actionId: string;
  expectedRevision: number;
  content: ServiceDraftContent;
};
export const SERVICE_DRAFT_LIMITS: Readonly<{
  bytes: number;
  receipts: number;
}>;
export function parseServiceDraftContent(value: unknown): ServiceDraftContent;
export function parseServiceDraft(value: unknown): ServiceDraft;
export function parseServiceDraftSave(value: unknown): ServiceDraftSave;
export function serializeServiceDraftSave(value: unknown): string;
export function newServiceDraftContent(
  description: string,
): ServiceDraftContent;

export type NodeLibrary = {
  name: string;
  version: string;
  registryIntegrity: string;
  files: ServiceSourceFile[];
};
export type NodeBundle = {
  entrypoint: string;
  files: ServiceSourceFile[];
  dependencies: NodeLibrary[];
};
export function parseNodeDependencies(value: unknown): NodeLibrary[];
export function supportedNodeLibraries(): NodeLibrary[];
export function parseNodeBundle(value: unknown): NodeBundle;
