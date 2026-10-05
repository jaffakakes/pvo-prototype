import type { ServiceSourceFile } from "../services/index.js";
import type { WorkspaceSnapshot } from "../workspaces/index.js";
export type BuilderTool =
  | { kind: "workspace_list" }
  | { kind: "workspace_read"; revision: number; path: string; offset: number }
  | {
      kind: "workspace_write";
      expectedRevision: number;
      files: ServiceSourceFile[];
    }
  | ({ revision: number; digest: string } & (
      | { kind: "workspace_start" }
      | { kind: "workspace_check"; path: string }
      | { kind: "workspace_test"; paths: string[] }
    ))
  | { kind: "workspace_result"; operationId: string };
export const BUILDER_TOOL_LIMITS: Readonly<{
  readBytes: number;
}>;
export const BUILDER_TOOL_KINDS: readonly BuilderTool["kind"][];
export function parseBuilderTool(value: unknown): BuilderTool;
export type BuilderReadResult =
  | {
      revision: number;
      digest: string | null;
      files: Array<{ path: string; bytes: number }>;
    }
  | {
      revision: number;
      digest: string;
      path: string;
      offset: number;
      content: string;
      nextOffset: number | null;
    };
export function readBuilderWorkspace(
  source: WorkspaceSnapshot | null,
  tool: BuilderTool,
): BuilderReadResult;
export function builderToolDefinitions(
  available: readonly BuilderTool["kind"][],
): Array<{ kind: BuilderTool["kind"]; description: string; schema: object }>;
export function parseBuilderReadResult(
  tool: BuilderTool,
  value: unknown,
): BuilderReadResult;
export function serializeBuilderTool(value: unknown): string;
