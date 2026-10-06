import type { VerifiedServiceAttachment } from "../attachments/index.js";
import type { NativeOperation } from "../native/index.js";
import type {
  TaskArtifact,
  TaskRecord,
  TaskReference,
} from "../tasks/index.js";

export type PreparedComponentOperation = Extract<
  NativeOperation,
  {
    kind:
      | "component.add"
      | "component.update"
      | "component.content"
      | "component.style"
      | "component.source"
      | "component.delete";
  }
>;
export type PreparedTaskResult = {
  kind: "component_changes";
  ownerId: string;
  projectId: string;
  taskId: string;
  baseFingerprint: string;
  operations: PreparedComponentOperation[];
  attachment: VerifiedServiceAttachment | null;
};
export type TaskApplication = TaskReference & { artifact: TaskArtifact };
export const PREPARED_COMPONENT_OPERATIONS: readonly PreparedComponentOperation["kind"][];
export function parsePreparedTaskResult(value: unknown): PreparedTaskResult;
export function prepareTaskResult(
  task: TaskRecord,
  operations: unknown,
  attachment?: VerifiedServiceAttachment | null,
): PreparedTaskResult;
export function matchPreparedTaskResult(
  value: unknown,
  task: TaskRecord,
): PreparedTaskResult;
export function parseTaskApplication(value: unknown): TaskApplication;
export function serializePreparedTaskResult(value: unknown): string;
