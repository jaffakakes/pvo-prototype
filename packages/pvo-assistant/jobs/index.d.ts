export type JobState =
  "received" | "pending" | "confirmed" | "failed" | "needs_checking";
export type JobReceipt = {
  actionId: string;
  job: {
    status: JobState;
    label: string;
    updatedAt: number;
    result: import("../services/index.js").ServiceJson;
    expiresAt: number | null;
    nextCheckAt: number | null;
  };
};
export type JobSummary = {
  actionId: string;
  operation: string;
  releaseId: string;
  status: JobState;
  label: string;
  attempts: number;
  polls: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  nextAt: number | null;
  schedule: { at: number; timezone: string } | null;
  lastError: string | null;
  providerReceipts: Array<{
    connectionId: string;
    index: number;
    provider: "resend";
    id: string;
    state: string;
    updatedAt: number;
  }>;
  canCancel: boolean;
  canResume: boolean;
};
export type CreatorJobs = {
  ownerId: string;
  serviceId: string;
  observedAt: number;
  jobs: JobSummary[];
};
export const JOB_LIMITS: Readonly<{
  records: number;
  bytes: number;
  daily: number;
  attempts: number;
  leaseMs: number;
  lifetimeMs: number;
  retentionMs: number;
  scheduleMs: number;
}>;
export function parseCreatorJobs(
  value: unknown,
  ownerId: string,
  serviceId: string,
): CreatorJobs;
export function parseJobReceipt(
  value: unknown,
  actionId?: string,
  resultSchema?: import("../services/index.js").ServiceValueSchema,
): JobReceipt;
export function receiptFinished(value: JobReceipt | null): boolean;
export function advanceJobReceipt(
  previous: JobReceipt | null,
  next: JobReceipt,
): JobReceipt;
