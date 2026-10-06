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

/** Answered questions leave the recent context only when the repository can archive them. */
export function checkpointTaskQuestions(task, retainedQuestionId) {
  const retained = Math.floor(TASK_LIMITS.questions / 2);
  const removable = task.questions
    .slice(0, Math.max(0, task.questions.length - retained))
    .filter((item) => item.answer !== null && item.id !== retainedQuestionId);
  const ids = new Set(removable.map((item) => item.id));
  task.questions = task.questions.filter((item) => !ids.has(item.id));
  task.archivedQuestions += removable.length;
}
