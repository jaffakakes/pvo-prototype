import type { TaskRecord } from "../tasks/index.js";
import type { ServiceSourceFile } from "../services/index.js";
export type WorkspaceIdentity = {
  resourceId: string;
  ownerId: string;
  projectId: string;
  taskId: string;
  deadlineAt: number;
  expiresAt: number;
};
export type WorkspaceSnapshot = {
  revision: number;
  digest: string;
  files: ServiceSourceFile[];
};
export const WORKSPACE_LIMITS: Readonly<{
  operations: number;
  sessions: number;
  sessionMs: number;
  commandMs: number;
  startupMs: number;
  outputBytes: number;
  concurrent: number;
  dailySessions: number;
  cleanupAttempts: number;
}>;
export function parseWorkspaceIdentity(value: unknown): WorkspaceIdentity;
export function serializeWorkspaceIdentity(value: unknown): string;
export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot;
export type WorkspaceLease = {
  id: string;
  resourceId: string;
  session: number;
  sourceRevision: number;
  startedAt: number;
  deadlineAt: number;
  expiresAt: number;
};
export type WorkspaceAction = {
  id: string;
  kind: "start" | "command";
  generation: number;
  deadlineAt: number;
};
export type WorkspaceState = {
  identity: WorkspaceIdentity;
  closed: boolean;
  generation: number;
  sourceRevision: number;
  sessions: number;
  grant: WorkspaceGrant | null;
  revokedThrough: number;
  active: WorkspaceAction | null;
  lease: WorkspaceLease | null;
  cleanupRequired: boolean;
  cleanupAttempts: number;
  nextCleanupAt: number | null;
  contentExpired: boolean;
};
export type WorkspaceSave = {
  id: string;
  expectedRevision: number;
  files: ServiceSourceFile[];
};
export type WorkspaceRun = { id: string; revision: number; digest: string };
export type WorkspaceCommand = { kind: "check" | "test"; paths: string[] };
export function parseWorkspaceSave(value: unknown): WorkspaceSave;
export function parseWorkspaceRun(
  value: unknown,
  command?: false,
): WorkspaceRun;
export function parseWorkspaceRun(
  value: unknown,
  command: true,
): WorkspaceRun & { command: WorkspaceCommand };
export function parseWorkspaceLease(value: unknown): WorkspaceLease;
export function workspaceCommandArguments(command: WorkspaceCommand): string[];
export function newWorkspace(
  identity: WorkspaceIdentity,
  now: number,
): WorkspaceState;
export function assertWorkspaceOwner(
  state: WorkspaceState,
  identity: WorkspaceIdentity,
): void;
export function assertWorkspaceOpen(state: WorkspaceState, now: number): void;
export function advanceWorkspaceSource(
  state: WorkspaceState,
  revision: number,
  now: number,
): WorkspaceState;
export function beginWorkspaceAction(
  state: WorkspaceState,
  action: { id: string; kind: WorkspaceAction["kind"]; now: number },
): WorkspaceState;
export function assertWorkspaceAction(
  state: WorkspaceState,
  action: WorkspaceAction,
  now: number,
): void;
export function finishWorkspaceAction(
  state: WorkspaceState,
  action: WorkspaceAction,
  now: number,
): WorkspaceState;
export function interruptWorkspace(
  state: WorkspaceState,
  now: number,
  close?: boolean,
): WorkspaceState;
export function settleWorkspaceCleanup(state: WorkspaceState): WorkspaceState;
export function deferWorkspaceCleanup(
  state: WorkspaceState,
  now: number,
): WorkspaceState;
export function workspaceWakeup(
  state: WorkspaceState,
  now: number,
): number | null;
export type WorkspaceGrant = {
  id: string;
  generation: number;
  expiresAt: number;
};
export function parseWorkspaceGrant(value: unknown): WorkspaceGrant;
export function authorizeWorkspaceExecution(
  state: WorkspaceState,
  grant: WorkspaceGrant,
  now: number,
): WorkspaceState;
export function assertWorkspaceGrant(state: WorkspaceState, now: number): void;
export function revokeWorkspaceGrant(
  state: WorkspaceState,
  generation: number,
): WorkspaceState;
export function parseWorkspaceOperationId(value: unknown): string;
export type WorkspaceOperationKind = "save" | "start" | "command";
export function serializeWorkspaceRequest(
  kind: WorkspaceOperationKind,
  value: unknown,
): string;
export type WorkspaceReceipt = { id: string; digest: string } & (
  | { kind: WorkspaceOperationKind; status: "pending"; result: null }
  | {
      kind: WorkspaceOperationKind;
      status: "interrupted";
      result: {
        code:
          | "workspace_stopped"
          | "workspace_claim_revoked"
          | "workspace_execution_interrupted"
          | "workspace_budget_exhausted"
          | "workspace_provider_unavailable"
          | "workspace_output_limit";
      };
    }
  | {
      kind: "save";
      status: "completed";
      result: { revision: number; digest: string };
    }
  | {
      kind: "start";
      status: "completed";
      result: { revision: number; digest: string; deadlineAt: number };
    }
  | {
      kind: "command";
      status: "completed";
      result: { stdout: string; stderr: string; exitCode: number };
    }
);
export type WorkspaceObservation = Pick<
  WorkspaceState,
  | "identity"
  | "closed"
  | "cleanupRequired"
  | "cleanupAttempts"
  | "active"
  | "grant"
  | "revokedThrough"
  | "lease"
> & { source: WorkspaceSnapshot | null };
export function parseWorkspaceReceipt(value: unknown): WorkspaceReceipt;
export function parseWorkspaceObservation(
  value: unknown,
  expected: WorkspaceIdentity,
): WorkspaceObservation;
export function workspaceTaskCleanup(
  task: TaskRecord | null | undefined,
  identity: WorkspaceIdentity,
  grant: WorkspaceGrant,
  now: number,
): "stop" | "suspend" | null;
