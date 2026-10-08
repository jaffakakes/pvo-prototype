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
