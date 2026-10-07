import type {
  ServiceAgreement,
  ServicePackage,
  ServiceTestIdentity,
  ServiceTestReport,
} from "../services/index.js";
export type ServiceReleaseIdentity = ServiceTestIdentity & {
  resourceId: string;
  serviceId: string;
  ownerId: string;
  projectId: string;
  taskId: string;
  operationId: string;
  reportDigest: string;
  draftRevision: number | null;
  expiresAt: number;
};
export type CheckedService = {
  artifact: {
    agreement: ServiceAgreement;
    package: ServicePackage;
    identity: ServiceTestIdentity;
  };
  report: ServiceTestReport;
};
export type ServicePublication = CheckedService & {
  identity: ServiceReleaseIdentity;
};
export type ServiceObservation = {
  identity: ServiceReleaseIdentity;
  state: "missing" | "available" | "retained" | "deleted";
};
export const INACTIVE_SERVICE_LIMITS: Readonly<{
  lifetimeMs: number;
  publicationBytes: number;
  inputBytes: number;
  outputBytes: number;
  probes: number;
  probeMs: number;
}>;
export function parseCheckedService(value: unknown): CheckedService;
export function parseServiceIdentity(value: unknown): ServiceReleaseIdentity;
export function parseServicePublication(value: unknown): ServicePublication;
export function parseServiceObservation(
  value: unknown,
  expected: ServiceReleaseIdentity,
): ServiceObservation;
export function sameServiceIdentity(
  a: ServiceReleaseIdentity,
  b: ServiceReleaseIdentity,
): boolean;
export function serializeServiceIdentity(value: unknown): string;

export function serializeServicePublication(value: unknown): string;
export function parseInactiveProbe(value: unknown): {
  operation: string;
  input: unknown;
};
export const SERVICE_CATALOG_LIMITS: Readonly<{
  active: number;
  identities: number;
  daily: number;
  releases: number;
}>;
export type OwnedService = {
  identity: Pick<ServiceReleaseIdentity, "serviceId" | "ownerId" | "projectId">;
  description: string;
  hostRevision: number | null;
  state: "inactive" | "active" | "paused" | "deleted";
  createdAt: number;
  updatedAt: number;
};
export type OwnedRelease = {
  identity: ServiceReleaseIdentity;
  runtime: ServicePackage["runtime"];
  permissions: Array<
    Pick<ServiceAgreement["operations"][number], "name" | "audience" | "access">
  >;
  state: "pending" | "inactive" | "retained" | "deleted";
  createdAt: number;
  updatedAt: number;
};
export function parseOwnedService(value: unknown): OwnedService;
export function parseOwnedRelease(value: unknown): OwnedRelease;

export function planOwnedPublication(
  task: import("../tasks/index.js").TaskRecord,
  value: ServicePublication,
  snapshot: {
    service: OwnedService | null;
    prior: OwnedRelease | null;
    services: OwnedService[];
    releases: OwnedRelease[];
  },
  now: number,
): { service: OwnedService; release: OwnedRelease };
export function observeOwnedRelease(
  release: OwnedRelease | null,
  identity: ServiceReleaseIdentity,
  state: ServiceObservation["state"],
  now: number,
): OwnedRelease;
export function admitOwnedService(services: OwnedService[], now: number): void;
