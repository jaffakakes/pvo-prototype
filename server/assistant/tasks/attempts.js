import { transitionTask } from "../../../packages/pvo-assistant/tasks/index.js";

import {
  transitionGuard as guard,
  taskClaim as claimOf,
  hasCurrentClaim as activeClaim,
} from "./executionClaim.js";

/** An inference journal is separate from the model's output and survives lost replies. */
export class TaskAttempts {
  constructor(sql, tasks) {
    this.sql = sql;
    this.tasks = tasks;
    sql.exec(`CREATE TABLE IF NOT EXISTS task_attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
      body TEXT NOT NULL)`);
    sql.exec(
      "CREATE INDEX IF NOT EXISTS task_attempts_unfinished ON task_attempts(task_id) WHERE json_extract(body,'$.finished')=0",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS task_attempts_budget ON task_attempts(json_extract(body,'$.budgetRetryAt')) WHERE json_extract(body,'$.finished')=1 AND json_extract(body,'$.budgetSettled')=0",
    );
  }

  entries() {
    return this.sql
      .exec("SELECT body FROM task_attempts")
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  get(id) {
    const row = this.sql
      .exec("SELECT body FROM task_attempts WHERE id=?", id)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  unfinished() {
    return this.sql
      .exec(
        "SELECT body FROM task_attempts WHERE json_extract(body,'$.finished')=0",
      )
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  write(attempt) {
    this.sql.exec(
      "INSERT OR REPLACE INTO task_attempts (id, task_id, body) VALUES (?, ?, ?)",
      attempt.id,
      attempt.taskId,
      JSON.stringify(attempt),
    );
  }
  task(id) {
    return this.tasks.records().find((task) => task.id === id);
  }
  current(claimed, now) {
    return activeClaim(this.task(claimed.id), claimed, now);
  }

  begin(claimed, identity, inputDigest, now) {
    let task = this.task(claimed.id);
    if (!activeClaim(task, claimed, now)) return null;
    const revision = task.revision;
    const operation = {
      id: `inference-${task.generation}`,
      stepId: task.stepId,
      inputDigest,
      status: "planned",
      resources: [],
      artifact: null,
      failure: null,
      createdAt: now,
      updatedAt: now,
    };
    task = transitionTask(
      task,
      { kind: "reserve_usage", modelTurns: 1, toolCalls: 0 },
      guard(task, now, claimOf(task)),
    );
    task = transitionTask(
      task,
      { kind: "record_operation", operation },
      guard(task, now, claimOf(task)),
    );
    const attempt = {
      id: operation.id,
      taskId: task.id,
      generation: task.generation,
      budget: identity,
      dispatched: false,
      finished: false,
      budgetSettled: false,
      budgetRetries: 0,
      budgetRetryAt: now,
    };
    // Operation IDs are task-local; use the pair for the SQL journal key.
    attempt.id = `${task.id}_${operation.id}`;
    attempt.operationId = operation.id;
    this.tasks.save(task, revision);
    this.write(attempt);
    return attempt;
  }

  dispatch(claimed, attempt, now) {
    if (!this.current(claimed, now)) return false;
    attempt.dispatched = true;
    this.write(attempt);
    return true;
  }

  finish(claimed, attempt, command, code, now) {
    const saved = this.get(attempt.id);
    if (!saved || saved.finished) return;
    let task = this.task(attempt.taskId);
    if (!task) throw new Error("Inference journal lost its task");
    const revision = task.revision;
    const current = activeClaim(task, claimed, now);
    if (!current && task.state === "running") {
      if (now < task.claim.expiresAt) return;
      task = transitionTask(task, { kind: "recover" }, guard(task, now));
    }
    const apply = (next) => {
      task = transitionTask(
        task,
        next,
        guard(task, now, current ? claimOf(task) : null),
      );
    };
    const prior = task.operations.find(
      (item) => item.id === attempt.operationId,
    );
    const operation = {
      ...prior,
      updatedAt: now,
      status: code ? (attempt.dispatched ? "failed" : "absent") : "completed",
      failure:
        code && attempt.dispatched ? { code, stepId: prior.stepId } : null,
    };
    apply({
      kind: current ? "record_operation" : "reconcile_operation",
      operation,
    });
    apply({
      kind: current ? "settle_usage" : "reconcile_usage",
      ...(!current ? { operationId: attempt.operationId } : {}),
      modelTurns: 1,
      toolCalls: 0,
      consumed: attempt.dispatched,
    });
    let accepted = false;
    if (current) {
      try {
        apply(
          code
            ? { kind: "fail", failure: { code, stepId: task.stepId } }
            : command,
        );
        accepted = !code;
      } catch {
        apply({
          kind: "fail",
          failure: { code: "invalid_result", stepId: task.stepId },
        });
      }
    }
    this.tasks.save(task, revision);
    this.write({ ...attempt, finished: true, budgetRetryAt: now });
    return accepted;
  }

  recover(now) {
    for (const attempt of this.unfinished()) {
      const task = this.task(attempt.taskId);
      if (!task) throw new Error("Inference journal lost its retained task");
      if (task.state === "running" && now < task.claim.expiresAt) continue;
      // These are planning inferences only: no deployment, message or other external write.
      // A lost inference is charged conservatively, and its unknown answer is discarded.
      this.finish(
        {
          id: task.id,
          generation: attempt.generation,
          claim: { id: "expired" },
        },
        attempt,
        null,
        "interrupted",
        now,
      );
    }
  }

  pendingBudget(now) {
    return this.sql
      .exec(
        `SELECT body FROM task_attempts
      WHERE json_extract(body,'$.finished')=1 AND json_extract(body,'$.budgetSettled')=0
      AND json_extract(body,'$.budgetRetryAt')<=? ORDER BY json_extract(body,'$.budgetRetryAt'),id LIMIT 4`,
        now,
      )
      .toArray()
      .map((row) => JSON.parse(row.body));
  }

  budgetDone(attempt) {
    const current = this.get(attempt.id);
    if (current) this.write({ ...current, budgetSettled: true });
  }
  budgetFailed(attempt, now) {
    const current = this.get(attempt.id);
    if (!current || current.budgetSettled) return;
    attempt = current;
    const retries = attempt.budgetRetries + 1;
    this.write({
      ...attempt,
      budgetRetries: retries,
      budgetRetryAt:
        retries < 3
          ? now + 60000 * 2 ** retries
          : Math.max(
              now + 60000,
              Date.parse(`${attempt.budget.day}T00:00:00Z`) + 25 * 3600000,
            ),
    });
  }
  nextBudgetWakeup() {
    return this.sql
      .exec(
        `SELECT MIN(json_extract(body,'$.budgetRetryAt')) AS next FROM task_attempts
      WHERE json_extract(body,'$.finished')=1 AND json_extract(body,'$.budgetSettled')=0`,
      )
      .one().next;
  }
  prune() {
    // Keep unsettled billing even after private task content expires.
    this.sql.exec(`DELETE FROM task_attempts
      WHERE json_extract(body,'$.finished')=1 AND json_extract(body,'$.budgetSettled')=1
      AND NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.id=task_attempts.task_id AND record IS NOT NULL)`);
  }
}
