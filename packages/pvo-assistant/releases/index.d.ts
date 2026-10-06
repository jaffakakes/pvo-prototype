export type ServiceReleaseIdentity = {
  resourceId: string;
  ownerId: string;
  projectId: string;
  taskId: string;
  operationId: string;
  sourceDigest: string;
  expiresAt: number;
};
export type ServicePublication = {
  identity: ServiceReleaseIdentity;
  source: string;
};
export type ServiceObservation = {
  identity: ServiceReleaseIdentity;
  state: "missing" | "available" | "deleted";
};
export const INACTIVE_SERVICE_LIMITS: Readonly<{
  sourceBytes: number;
  inputBytes: number;
  outputBytes: number;
  probes: number;
  cpuMs: number;
  probeMs: number;
}>;
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

export function parseServiceSource(value: unknown): string;
