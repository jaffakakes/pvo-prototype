import {
  TASK_FAILURES,
  type TaskRecord,
} from "../../../../packages/pvo-assistant/tasks/index.js";

const failureMessages = {
  provider_unavailable: "The service needed for this step is unavailable.",
  interrupted: "Work was interrupted before this step finished.",
  reconciliation_required:
    "An earlier action needs to be checked before work can continue.",
  execution_failed: "The current step could not be completed.",
  invalid_result: "The result did not pass validation.",
  budget_exceeded: "This task reached its work limit.",
};

export function savedTaskStatus(task: TaskRecord) {
  const label = {
    queued: "Working",
    running: "Working",
    waiting_for_answer: "Needs your answer",
    ready: "Ready",
    stopped: "Stopped",
    failed: "Failed",
  }[task.state];
  const buildUnavailable =
    task.failure?.code === "provider_unavailable" && task.stepId === "build";
  const uncertain = task.operations.some((operation) =>
    ["planned", "unknown"].includes(operation.status),
  );
  const message = task.failure
    ? buildUnavailable
      ? "Planning is saved. Building hosted services is not available yet."
      : failureMessages[task.failure.code]
    : task.state === "ready"
      ? "Your result is saved."
      : task.state === "stopped"
        ? uncertain
          ? "Further work was stopped. An earlier action still needs its outcome checked."
          : "Further work was stopped. Your saved progress is still available."
        : task.state === "waiting_for_answer"
          ? "Your answer will be saved before work continues."
          : "You can close Restyle and return to this task.";
  return {
    label,
    message,
    canStop: ["queued", "running", "waiting_for_answer", "failed"].includes(
      task.state,
    ),
    canResume:
      task.state === "failed" &&
      !!task.failure &&
      !buildUnavailable &&
      TASK_FAILURES[task.failure.code].retryable,
    question:
      task.state === "waiting_for_answer"
        ? (task.questions.find((item) => item.answer === null) ?? null)
        : null,
  };
}
