import type { NativeOperation } from "../native/index.js";
import type {
  ServiceObservation,
  ServicePublication,
  ServiceReleaseIdentity,
} from "../releases/index.js";
import type { ServiceJson, ServiceOperation } from "../services/index.js";
import type { TaskReference } from "../tasks/index.js";
export const SERVICE_ATTACHMENT_BYTES: number;
export type PublishedServiceOperations = {
  service: import("../hosting/index.js").HostedServiceRecord;
  operations: ServiceAttachmentReceipt[];
};
export function parsePublishedServiceOperations(
  value: unknown,
): PublishedServiceOperations;

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

/** A local replay scope, not server authority. Public player checkpoints contain no creator account. */
export type ServiceSubmissionScope =
  { mode: "try"; ownerId: string } | { mode: "public"; ownerId: null };
export type ServiceSubmissionTarget = ServiceSubmissionScope & {
  origin: string;
  serviceId: string;
  releaseId: string;
  operation: ServiceOperation & { audience: "public" };
};
export type ServiceSubmission = {
  target: ServiceSubmissionTarget;
  action: import("../hosting/index.js").ServiceAction;
  receiptKey?: string;
  response:
    | import("../hosting/index.js").ServiceActionResult
    | import("../jobs/index.js").JobReceipt
    | null;
};
export function parseServiceSubmissionTarget(
  value: unknown,
): ServiceSubmissionTarget;
export function prepareServiceSubmissionTarget(
  connection: ComponentServiceConnection,
  scope: ServiceSubmissionScope,
): ServiceSubmissionTarget;
export function resolveServiceSubmissionInput(
  connection: ComponentServiceConnection,
  fields: Record<string, unknown>,
): ServiceJson;
export function parseServiceSubmission(value: unknown): ServiceSubmission;
/** Supply a new unpredictable host-generated ID; persist the returned record before dispatch. */
export function prepareServiceSubmission(
  target: ServiceSubmissionTarget,
  input: unknown,
  actionId: string,
  receiptKey?: string,
): ServiceSubmission;
/** Retries restore the saved input; they never read new form values. */
export function retryServiceSubmission(
  value: unknown,
  currentTarget: ServiceSubmissionTarget,
): ServiceSubmission;
export function completeServiceSubmission(
  value: unknown,
  response: unknown,
): ServiceSubmission;
export function serviceSubmissionRequest(value: unknown): {
  url: string;
  method: "POST";
  headers: { "Content-Type": "application/json" };
  body: string;
};

export type ServiceSubmissionStore = {
  read(slot: string): Promise<ServiceSubmission | null>;
  /** Run change atomically across clients; resolve only after the write commits. */
  update(
    slot: string,
    change: (current: ServiceSubmission | null) => ServiceSubmission,
  ): Promise<ServiceSubmission>;
};
export type ServiceSubmissionContext = {
  signal?: AbortSignal;
  isCurrent(): boolean;
};
export function createServiceSubmissionClient(adapters: {
  store: ServiceSubmissionStore;
  createId(): string;
  createReceiptKey?(): string;
  send(
    request: ReturnType<typeof serviceSubmissionRequest>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}): {
  check(
    slot: string,
    target: ServiceSubmissionTarget,
    context: ServiceSubmissionContext,
    expectedActionId?: string,
  ): Promise<ServiceSubmission>;
  submit(
    slot: string,
    target: ServiceSubmissionTarget,
    input: unknown,
    context: ServiceSubmissionContext,
  ): Promise<ServiceSubmission>;
  retry(
    slot: string,
    target: ServiceSubmissionTarget,
    context: ServiceSubmissionContext,
    expectedActionId?: string,
  ): Promise<ServiceSubmission>;
};

/** Browser adapter; close when the host session is disposed. */
export function openServiceSubmissionStore(
  factory?: IDBFactory,
): Promise<ServiceSubmissionStore & { close(): void }>;

export function matchesComponentServiceRequest(
  connection: ComponentServiceConnection,
  request: { url: string; method: string; body?: string },
): boolean;

/** Viewer data only. It contains no authoring receipt and cannot authorize activation or private calls. */
export type PublicServiceConnection = Pick<
  ServiceSubmissionTarget,
  "origin" | "serviceId" | "releaseId" | "operation"
> &
  Pick<ServiceAttachmentCommand["connection"], "event" | "target" | "input">;
export function parsePublicServiceConnection(
  value: unknown,
): PublicServiceConnection;
export function projectPublicServiceConnection(
  value: ComponentServiceConnection,
): PublicServiceConnection;
export function publicServiceSubmissionTarget(
  value: PublicServiceConnection,
): ServiceSubmissionTarget & { mode: "public"; ownerId: null };
export function resolvePublicServiceSubmissionInput(
  value: PublicServiceConnection,
  fields: Record<string, unknown>,
): ServiceJson;
export function matchesPublicServiceRequest(
  value: PublicServiceConnection,
  request: { url: string; method: string; body?: string },
): boolean;

/** HTTP status only; never exposes a private response body. */
export class ServiceSubmissionHttpError extends Error {
  constructor(status: number);
  readonly status: number;
}
export function sendServiceSubmission(
  request: ReturnType<typeof serviceSubmissionRequest>,
  target: ServiceSubmissionTarget,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown>;

/** Checks bindings against actual compiled/declared control fields; parsing alone is insufficient. */
export function validateServiceBindingFields(
  binding: ServiceInputBinding,
  schema: import("../services/index.js").ServiceValueSchema,
  structure: import("../../pvo-language/index.js").PvoLanguageStructure,
): void;

export function recoverServiceSubmissionFields(
  value: ServiceSubmission,
  target: ServiceSubmissionTarget,
  binding: ServiceInputBinding,
): Record<string, ServiceJson>;

export function backgroundSubmission(target: ServiceSubmissionTarget): boolean;
export function submissionFinished(saved: ServiceSubmission): boolean;

export function serviceReceiptLink(saved: ServiceSubmission): string;
