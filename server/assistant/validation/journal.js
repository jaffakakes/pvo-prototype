import { transitionTask } from "../../../packages/pvo-assistant/tasks/index.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "../tasks/executionClaim.js";

/** Read-only capture / isolated case attempts. A lost result is charged, never counted as a passed case. */
export class ServiceValidationJournal {
  constructor(sql, tasks) {
    this.sql = sql;
    this.tasks = tasks;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS task_validation_attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL)",
    );
  }
  entries() {
    return this.sql
      .exec("SELECT body FROM task_validation_attempts")
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  task(id) {
    return this.tasks.records().find((task) => task.id === id);
  }
  get(id) {
    const row = this.sql
      .exec("SELECT body FROM task_validation_attempts WHERE id=?", id)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  write(row) {
    this.sql.exec(
      "INSERT INTO task_validation_attempts (id,task_id,body) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      row.id,
      row.taskId,
      JSON.stringify(row),
    );
  }
  begin(claimed, input, inputDigest, now) {
    let task = this.task(claimed.id);
    if (!hasCurrentClaim(task, claimed, now)) return null;
    if (task.stepId !== "validate")
      throw new Error("Validation requires its own claim.");
    const operationId = `validate-${task.generation}`;
    const id = `${task.id}_${operationId}`;
    const prior = this.get(id);
    if (prior) {
      if (prior.inputDigest !== inputDigest)
        throw new Error("Validation intent conflicts.");
      return null; // This claim already dispatched; only recovery may admit another attempt.
    }
    const revision = task.revision;
    const apply = (command) => {
      task = transitionTask(
        task,
        command,
        transitionGuard(task, now, taskClaim(task)),
      );
    };
    apply({ kind: "reserve_usage", modelTurns: 0, toolCalls: 1 });
    apply({
      kind: "record_operation",
      operation: {
        id: operationId,
        stepId: "validate",
        inputDigest,
        status: "planned",
        resources: [],
        artifact: null,
        failure: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    const row = {
      id,
      taskId: task.id,
      operationId,
      input,
      inputDigest,
      claim: taskClaim(task),
      deadlineAt: task.claim.expiresAt,
      settled: false,
      status: "pending",
    };
    this.tasks.save(task, revision);
    this.write(row);
    return row;
  }
  finish(id, status, now, artifact = null) {
    const row = this.get(id);
    if (!row || row.settled) return false;
    if (!["completed", "failed", "interrupted"].includes(status))
      throw new Error("Unknown validation outcome.");
    let task = this.task(row.taskId);
    if (!task) throw new Error("Validation lost its retained task.");
    const current = hasCurrentClaim(
      task,
      { claim: { id: row.claim.id }, generation: row.claim.generation },
      now,
    );
    if (task.state === "running" && !current && now < task.claim.expiresAt)
      return false;
    const revision = task.revision;
    if (task.state === "running" && !current)
      task = transitionTask(
        task,
        { kind: "recover" },
        transitionGuard(task, now),
      );
    const apply = (command) => {
      task = transitionTask(
        task,
        command,
        transitionGuard(task, now, current ? taskClaim(task) : null),
      );
    };
    const operation = task.operations.find(
      (item) => item.id === row.operationId,
    );
    apply({
      kind: current ? "record_operation" : "reconcile_operation",
      operation: {
        ...operation,
        ...(current && artifact
          ? { artifact, resources: [{ kind: "artifact", id: artifact.id }] }
          : {}),
        status: status === "completed" ? "completed" : "failed",
        failure:
          status === "completed"
            ? null
            : {
                code:
                  status === "interrupted" ? "interrupted" : "execution_failed",
                stepId: "validate",
              },
        updatedAt: now,
      },
    });
    apply({
      kind: current ? "settle_usage" : "reconcile_usage",
      ...(!current ? { operationId: row.operationId } : {}),
      modelTurns: 0,
      toolCalls: 1,
      consumed: true,
    });
    this.tasks.save(task, revision);
    this.write({ ...row, settled: true, status });
    return current;
  }
  recover(now) {
    for (const row of this.entries().filter((row) => !row.settled)) {
      const task = this.task(row.taskId);
      if (task?.state === "running" && task.claim.expiresAt > now) continue;
      this.finish(row.id, "interrupted", now);
    }
  }
  nextWakeup(now) {
    const times = this.entries()
      .filter((row) => !row.settled)
      .map((row) =>
        this.task(row.taskId)?.state === "running" ? row.deadlineAt : now,
      );
    return times.length ? Math.min(...times) : null;
  }
  prune(now) {
    for (const row of this.entries()) {
      const task = this.task(row.taskId);
      if (
        row.settled &&
        (!task || (task.expiresAt !== null && task.expiresAt <= now))
      )
        this.sql.exec(
          "DELETE FROM task_validation_attempts WHERE id=?",
          row.id,
        );
    }
  }
}
