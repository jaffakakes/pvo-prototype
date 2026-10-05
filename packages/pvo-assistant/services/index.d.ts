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
export function parseServicePackage(value: unknown): ServicePackage;
export function serializeServicePackage(value: unknown): string;
export function matchServicePackage(
  value: unknown,
  expectedAgreementDigest: string,
): ServicePackage;
