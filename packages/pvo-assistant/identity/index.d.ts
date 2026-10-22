export type IdentityProvider = "agentmail" | "agentphone";
export type IdentityChannel = {
  provider: IdentityProvider;
  revision: number;
  status:
    | "starting"
    | "awaiting_verification"
    | "verifying"
    | "ready"
    | "needs_attention"
    | "disconnected";
  address: string | null;
  resourceId: string | null;
  connectionId: string | null;
  updatedAt: number;
  issue: string | null;
  approval: {
    kind: "create" | "existing";
    at: number;
    monthlyNumberCents: number;
  } | null;
};
export const IDENTITY_PROVIDERS: ReadonlyArray<IdentityProvider>;
export const IDENTITY_STATUSES: ReadonlyArray<IdentityChannel["status"]>;
export function identityEmail(value: unknown): string;
export function identityResource(value: unknown): string;
export function identityCredential(value: unknown): string;
export function parseIdentityChannel(value: unknown): IdentityChannel;
export function parseIdentityCommand(
  kind: string,
  value: unknown,
): Record<string, unknown>;
