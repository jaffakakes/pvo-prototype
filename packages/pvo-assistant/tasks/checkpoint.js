import { TASK_LIMITS } from "./limits.js";

/** The repository must archive removed settled receipts atomically with this record. */
export function checkpointTaskOperations(task, retainedOperationId) {
  if (task.usage.reservedModelTurns || task.usage.reservedToolCalls) return;
  const retained = Math.floor(TASK_LIMITS.operations / 2);
  if (task.operations.length <= retained) return;
  const removable = task.operations
    .slice(0, task.operations.length - retained)
    .filter(
      (item) =>
        item.id !== retainedOperationId &&
        !["planned", "unknown"].includes(item.status),
    );
  const ids = new Set(removable.map((item) => item.id));
  task.operations = task.operations.filter((item) => !ids.has(item.id));
  task.archivedOperations += removable.length;
}
