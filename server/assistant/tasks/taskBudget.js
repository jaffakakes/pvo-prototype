import { HttpError } from "../../http.js";
import { creationDigest } from "./input.js";

export async function taskBudgetIdentity(task, operationId, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    day,
    client: await creationDigest(["owner", day, task.ownerId]),
    key: await creationDigest(["task", task.ownerId, task.id, operationId]),
  };
}

function budget(env, identity) {
  if (!env.ASSISTANT_BUDGET)
    throw new HttpError(503, "The assistant budget is unavailable.");
  return env.ASSISTANT_BUDGET.getByName(`assistant:${identity.day}`);
}

export async function reserveTaskBudget(env, identity) {
  const result = await budget(env, identity).reserveTask(
    identity.client,
    identity.key,
  );
  if (result.accepted === true) return;
  if (
    ["model_capacity", "model_allowance"].includes(result.reason) &&
    Number.isSafeInteger(result.retryAt)
  )
    throw Object.assign(
      new Error("Saved work is waiting for model capacity."),
      {
        taskWait: { reason: result.reason, nextRunAt: result.retryAt },
      },
    );
  throw new Error("Inference reservation is closed or invalid.");
}

export async function settleTaskBudget(env, identity, consumed) {
  if (
    !(await budget(env, identity).settle(
      identity.client,
      identity.key,
      consumed,
    ))
  )
    throw new Error("Task inference reservation could not be reconciled");
}
