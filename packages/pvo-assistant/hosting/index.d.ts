import type {
  OwnedService,
  ServiceReleaseIdentity,
} from "../releases/index.js";
import type {
  ServiceAgreement,
  ServiceInvocation,
  ServiceReply,
} from "../services/index.js";
export const HOSTED_SERVICE_LIMITS: Readonly<{
  requestBytes: number;
  queued: number;
  dailyCalls: number;
  dailyExecutions: number;
  receipts: number;
  receiptBytes: number;
}>;
export type ServiceAction = {
  actionId: string;
  operation: string;
  input: unknown;
};
export type HostedServiceRecord = {
  identity: OwnedService["identity"];
  state: "inactive" | "active" | "paused" | "deleted";
  revision: number;
  testReleaseId: string | null;
  liveReleaseId: string | null;
  createdAt: number;
  updatedAt: number;
};
export type ServiceCallAuthority =
  | { kind: "public" }
  | { kind: "creator"; ownerId: string; mode: "test" | "live" };
export type ServiceCallScope = {
  namespace: "test" | "live";
  releaseId: string;
  audience: "creator" | "public";
};
export type ServiceActionReceipt = {
  actionId: string;
  operation: string;
  inputDigest: string;
  audience: "creator" | "public";
  releaseId: string;
  result: unknown;
  createdAt: number;
};
export type ServiceActionResult = { actionId: string; result: unknown };
export function serviceCallError(
  code: string,
  message: string,
): Error & { code: string };
export function parseServiceAction(value: unknown): ServiceAction;
export function serializeServiceAction(value: unknown): string;
export function parseHostedService(value: unknown): HostedServiceRecord;
export function newHostedService(
  identity: ServiceReleaseIdentity,
  now: number,
): HostedServiceRecord;
export function selectTestRelease(
  service: HostedServiceRecord,
  releaseId: string | null,
  now: number,
): HostedServiceRecord;
export function serviceCallScope(
  service: HostedServiceRecord | null,
  authority: ServiceCallAuthority,
): ServiceCallScope;
export function prepareHostedInvocation(
  agreement: ServiceAgreement,
  action: ServiceAction,
  state: unknown,
  now: number,
  audience: ServiceCallScope["audience"],
): ServiceInvocation;
export function checkedHostedReply(
  agreement: ServiceAgreement,
  invocation: ServiceInvocation,
  reply: unknown,
): ServiceReply;
export function replayServiceAction(
  receipt: ServiceActionReceipt | null,
  action: ServiceAction,
  digest: string,
  audience: ServiceCallScope["audience"],
): ServiceActionResult | null;

export type ServiceUsage = { day: number; calls: number; executions: number };
export function admitServiceUsage(
  previous: ServiceUsage | null,
  now: number,
  execution: boolean,
): ServiceUsage;
export function requireServiceReceiptCapacity(
  usage: { count: number; bytes: number },
  additionalBytes?: number,
): void;

export const SERVICE_CONTROL_RECEIPTS: number;
export type ServiceControl =
  | {
      kind: "activate";
      actionId: string;
      expectedRevision: number;
      releaseId: string;
    }
  | { kind: "pause" | "delete"; actionId: string; expectedRevision: number };
export type ServiceControlReceipt = {
  actionId: string;
  kind: ServiceControl["kind"];
  revision: number;
  at: number;
};
export type HostedServiceSummary = {
  service: HostedServiceRecord;
  releases: import("../releases/index.js").ServiceObservation[];
};
export function parseServiceControl(value: unknown): ServiceControl;
export function serializeServiceControl(value: unknown): string;
export function planServiceControl(
  service: HostedServiceRecord,
  control: ServiceControl,
  now: number,
): HostedServiceRecord;
export function parseHostedSummary(value: unknown): HostedServiceSummary;

export function prepareReleaseActivation(
  previous: ServiceAgreement | null,
  candidate: ServiceAgreement,
  state: unknown,
): import("../services/index.js").ServiceJson;
