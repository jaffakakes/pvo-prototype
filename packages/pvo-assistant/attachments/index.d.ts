import type { NativeOperation } from "../native/index.js";
import type {
  ServiceObservation,
  ServicePublication,
  ServiceReleaseIdentity,
} from "../releases/index.js";
import type { ServiceJson, ServiceOperation } from "../services/index.js";
import type { TaskReference } from "../tasks/index.js";

export type ServiceInputBinding =
  | { kind: "literal"; value: ServiceJson }
  | { kind: "field"; name: string }
  | { kind: "object"; fields: { name: string; value: ServiceInputBinding }[] }
  | { kind: "array"; items: ServiceInputBinding[] };
export type ServiceAttachmentCommand = {
  kind: "service.attach";
  component: Extract<
    NativeOperation,
    { kind: "component.add" | "component.source" }
  > & {
    source: { structure: string; style: string; logic: string };
  };
  connection: {
    releaseId: string;
    operation: string;
    event: "press" | "choose" | "submit";
    target: string | null;
    input: ServiceInputBinding;
  };
};
export type ServiceAttachmentReceipt = {
  identity: ServiceReleaseIdentity;
  operation: ServiceOperation & { audience: "public" };
  readiness: { state: "available" | "retained"; observedAt: number };
};
export type VerifiedServiceAttachment = {
  command: ServiceAttachmentCommand;
  receipt: ServiceAttachmentReceipt;
};
export type ServiceAttachmentAuthorization = VerifiedServiceAttachment & {
  scope: TaskReference;
  now: number;
  origin: string;
};
export function serviceAttachmentRequest(
  authorization: ServiceAttachmentAuthorization,
): {
  url: string;
  method: "POST";
  body: string;
};
export function matchAttachmentOperation(
  operation: NativeOperation,
  authorization?: ServiceAttachmentAuthorization,
): VerifiedServiceAttachment | null;
export function validateCompiledServiceAttachment(
  original: import("../../pvo-language/index.js").CompiledPvoComponent | null,
  proposed: import("../../pvo-language/index.js").CompiledPvoComponent,
  authorization: ServiceAttachmentAuthorization,
  context?: import("../index.js").AssistantContext,
): void;
export function parseServiceAttachmentCommand(
  value: unknown,
): ServiceAttachmentCommand;
export function parseServiceAttachmentReceipt(
  value: unknown,
): ServiceAttachmentReceipt;
export function prepareServiceAttachmentReceipt(
  publication: ServicePublication,
  observation: ServiceObservation,
  operationName: string,
  now: number,
): ServiceAttachmentReceipt;
export function matchServiceAttachment(
  value: unknown,
  receipt: unknown,
  scope: TaskReference,
  now: number,
): VerifiedServiceAttachment;

/** Persisted project metadata. Parsing never grants server permissions or current readiness. */
export type ComponentServiceConnection = {
  receipt: ServiceAttachmentReceipt;
  connection: ServiceAttachmentCommand["connection"];
  origin: string;
};
export function parseComponentServiceConnection(
  value: unknown,
): ComponentServiceConnection;
export function prepareComponentServiceConnection(
  authorization: ServiceAttachmentAuthorization,
): ComponentServiceConnection;

export const serviceAttachmentSchema: Record<string, unknown>;
