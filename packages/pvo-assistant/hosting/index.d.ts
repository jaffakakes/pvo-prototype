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
  | { kind: "component_test"; ownerId: string; releaseId: string }
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
  requestedReleaseRetained?: boolean,
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
      kind: "activate" | "reset_test";
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
  draftRevision: number | null;
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

export const SERVICE_RECORD_LIMITS: Readonly<{
  results: number;
  failures: number;
  bytes: number;
}>;
export const SERVICE_FAILURE_CODES: readonly string[];
export type ServiceRecordsArea = {
  pending: {
    actionId: string;
    operation: string;
    releaseId: string;
    status: "running" | "needs_checking";
    startedAt: number;
  } | null;

  mode: "live" | "test";
  releaseId: string;
  stored: boolean;
  version: number;
  recordsJson: string;
  usage: ServiceUsage;
  receipts: { count: number; bytes: number };
  results: {
    actionId: string;
    operation: string;
    releaseId: string;
    createdAt: number;
    resultJson: string;
  }[];
  failures: {
    actionId: string;
    operation: string;
    releaseId: string;
    at: number;
    code: string;
  }[];
};
export type ServiceRecords = {
  service: HostedServiceRecord;
  observedAt: number;
  areas: ServiceRecordsArea[];
  storageBytes: number;
  compute: ServiceCompute;
};
export function parseServiceRecords(value: unknown): ServiceRecords;

export type ServiceComputeMode = "live" | "test" | "validation" | "probe";
export type ServiceComputeCounters = {
  starts: number;
  milliseconds: number;
  startupMilliseconds: number;
  executionMilliseconds: number;
  cleanupMilliseconds: number;
  admittedBytes: number;
  resultBytes: number;
};
export type ServiceCompute =
  | { state: "unavailable" }
  | {
      state: "available";
      observedAt: number;
      periodStartAt: number;
      resetsAt: number;
      capacity: {
        slots: number;
        busySlots: number;
        ownerRemaining: number;
        ownerLimit: number;
        platformRemaining: number;
        platformLimit: number;
      };
      periods: Record<ServiceComputeMode, ServiceComputeCounters>;
      pending: {
        mode: ServiceComputeMode;
        startedAt: number;
        deadlineAt: number;
        phase: "running" | "cleanup";
        milliseconds: number;
      }[];
      estimate: {
        checkedOn: string;
        machineSecondUsd: number;
        completedUsd: number;
        pendingUsd: number;
      };
      instance: {
        provider: "fly";
        region: "iad";
        cpuKind: "shared";
        cpus: 1;
        memoryMiB: 1024;
      };
    };
export const SERVICE_COMPUTE_MODES: readonly ServiceComputeMode[];
export const SERVICE_COMPUTE_COUNTERS: readonly (keyof ServiceComputeCounters)[];
export function parseServiceCompute(value: unknown): ServiceCompute;

export function prepareReleaseActivation(
  previous: ServiceAgreement | null,
  candidate: ServiceAgreement,
  state: unknown,
): import("../services/index.js").ServiceJson;

export const SERVICE_CONNECTION_LIMITS: Readonly<{
  records: number;
  exports: number;
  components: number;
  publications: number;
  requestBytes: number;
  storedBytes: number;
  bytes: number;
}>;
export type ServiceConnectedComponent = {
  sceneId: string;
  sceneName: string;
  componentId: string;
  componentName: string;
  releaseId: string;
  operation: string;
};
export type ServiceConnectionReport = {
  kind: "project" | "export";
  referenceId: string;
  projectId: string;
  title: string;
  expectedRevision: number;
  components: ServiceConnectedComponent[];
};
export type ServiceConnectionRecord = {
  report: ServiceConnectionReport;
  revision: number;
  recordedAt: number;
  publications: { id: string; title: string; recordedAt: number }[];
};
export type ServiceConnections = {
  service: HostedServiceRecord;
  observedAt: number;
  records: ServiceConnectionRecord[];
};
export function parseServiceConnectionReport(
  value: unknown,
): ServiceConnectionReport;
export function parseServiceConnections(value: unknown): ServiceConnections;

export type ServiceAccountAccess = {
  ownerId: string;
  serviceId: string;
  releaseId: string;
  approved: boolean;
  bindings: Array<{
    name: string;
    operations: string[];
    description: string;
    permission: "repository:read" | "issues:read" | "issues:write";
    method: "GET" | "POST";
    documentation: string;
    repository: string | null;
    account: string | null;
    error: string | null;
  }>;
};
export function parseServiceAccountAccess(value: unknown): ServiceAccountAccess;
