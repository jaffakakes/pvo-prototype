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

export type ConnectionSetup =
  | {
      provider: "github";
      repository: string;
      access?: "issues_write";
    }
  | { provider: "resend"; from: string; recipient: string }
  | { provider: "agentmail" | "agentphone"; resourceId: string };
export type ConnectionInvocation =
  | { operation: "github_repository_read"; input: Record<string, never> }
  | { operation: "github_issues_list"; input: { page: number } };
export const GITHUB_OPERATIONS: ReadonlyArray<{
  id: string;
  permissions: string[];
}>;
export function parseConnectionSetup(value: unknown): ConnectionSetup;
export function parseConnectionInvocation(value: unknown): ConnectionInvocation;

export type ConnectionAdapter = {
  name: string;
  description: string;
  provider: "github" | "resend";
  method: "GET" | "POST";
  path: Array<string | { input: string }>;
  query: Array<{
    name: "state" | "page" | "per_page" | "sort" | "direction";
    value: string | { input: string };
  }>;
  input: import("../services/index.js").ServiceValueSchema;
  result: import("../services/index.js").ServiceValueSchema;
  responsePath: string[];
  permission: "repository:read" | "issues:read" | "issues:write" | "email:send";
  completion: "synchronous";
  documentation: string;
};
export const ADAPTER_LIMITS: Readonly<{
  bindings: number;
  calls: number;
  inputBytes: number;
  resultBytes: number;
}>;
export function parseConnectionAdapter(value: unknown): ConnectionAdapter;
export function adapterPolicy(adapter: ConnectionAdapter): {
  permission: string;
  effect: "read" | "write";
  recovery: "none" | "github_issue_marker" | "resend_idempotency";
};
export function parseAdapterInput(
  adapter: ConnectionAdapter,
  value: unknown,
): import("../services/index.js").ServiceJson;
export function projectAdapterResult(
  adapter: ConnectionAdapter,
  value: unknown,
): import("../services/index.js").ServiceJson;

export function connectionScopeKey(value: unknown): string;
export function parseResendCredential(value: string): {
  key: string;
  webhookSecret: string;
};
