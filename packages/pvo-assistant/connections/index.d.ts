export type ConnectionMetadata = {
  id: string;
  name: string;
  provider: string;
  status: "connected" | "expired" | "revoked";
  revision: number;
  permissions: string[];
  operations: Array<{ id: string; permissions: string[] }>;
};
export type ConnectionPage = {
  connections: ConnectionMetadata[];
  next: string | null;
  version: number;
};
export function parseConnectionMetadata(value: unknown): ConnectionMetadata;
export function parseConnectionPage(value: unknown): ConnectionPage;

export type ConnectionSetup = { provider: "github"; repository: string };
export type ConnectionInvocation =
  | { operation: "github_repository_read"; input: Record<string, never> }
  | { operation: "github_issues_list"; input: { page: number } };
export const GITHUB_OPERATIONS: ReadonlyArray<{
  id: string;
  permissions: string[];
}>;
export function parseConnectionSetup(value: unknown): ConnectionSetup;
export function parseConnectionInvocation(value: unknown): ConnectionInvocation;
