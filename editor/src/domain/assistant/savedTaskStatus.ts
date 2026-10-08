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
  tests_failed:
    "The saved draft did not pass its tests. Its code and the published version are unchanged. Stop this task, fix the draft and test again.",
  invalid_result: "The result did not pass validation.",
  budget_exceeded: "This task reached its work limit.",
};

const waitMessages = {
  model_capacity:
    "Model capacity is busy. Your progress is saved and work will resume automatically.",
  model_allowance:
    "The current model allowance is used. Your progress is saved and work will resume when it resets.",
  service_capacity:
    "Waiting for a free hosted test slot. Saved work will continue automatically.",
  service_allowance:
    "Waiting for hosted test allowance to reset. Saved work will continue automatically.",
  workspace_capacity:
    "A build computer is not available yet. Your progress is saved and Restyle will try again automatically.",
  workspace_allowance:
    "The current build allowance is used. Your progress is saved and work will resume when it resets.",
  spending_permission:
    "Your account needs spending permission for cloud work. Ask your Restyle administrator to enable it, then choose Resume.",
};

export function savedTaskStatus(task: TaskRecord) {
  const label = {
    queued: "Working",
    running: "Working",
    waiting_for_answer: "Needs your answer",
    waiting: "Waiting",
    ready: "Ready",
    stopped: "Stopped",
    failed: "Failed",
  }[task.state];
  const buildUnavailable =
    task.failure?.code === "provider_unavailable" && task.stepId === "build";
  const uncertain = task.operations.some((operation) =>
    ["planned", "unknown"].includes(operation.status),
  );
  const message = taskMessage(task, buildUnavailable, uncertain);
  return {
    label,
    message,
    canStop: [
      "queued",
      "running",
      "waiting_for_answer",
      "waiting",
      "failed",
    ].includes(task.state),
    canResume:
      task.state === "waiting" ||
      (task.state === "failed" &&
        !!task.failure &&
        !buildUnavailable &&
        TASK_FAILURES[task.failure.code].retryable),
    question: !["ready", "stopped"].includes(task.state)
      ? (task.questions.find((item) => item.answer === null) ?? null)
      : null,
  };
}

function taskMessage(
  task: TaskRecord,
  buildUnavailable: boolean,
  uncertain: boolean,
) {
  if (task.wait) return waitMessages[task.wait.reason];
  if (task.failure) {
    if (buildUnavailable)
      return "Planning is saved. Building hosted services is not available yet.";
    return failureMessages[task.failure.code];
  }
  if (task.state === "ready") return "Your result is saved.";
  if (task.state === "stopped") {
    if ("container" in task.input.context)
      return "Work on this draft has stopped. Refresh saved code to check any save that was already in progress. Published code is unchanged.";
    if (uncertain)
      return "Further work was stopped. An earlier action still needs its outcome checked.";
    return "Further work was stopped. Your saved progress is still available.";
  }
  if (
    ["queued", "running"].includes(task.state) &&
    task.questions.some((question) => question.answer === null)
  )
    return "You can answer now while independent research finishes. Other work waits for your answer.";
  if (task.state === "waiting_for_answer")
    return "Your answer will be saved before work continues.";
  return "You can close Restyle and return to this task.";
}
