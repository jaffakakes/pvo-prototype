import { transitionTask } from "../../../packages/pvo-assistant/tasks/index.js";
import { sameServiceIdentity } from "../../../packages/pvo-assistant/releases/index.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "./executionClaim.js";

const pending = (row) =>
  !row.settled || (row.cancelRequested && !row.cancelled);
const resource = (row) => ({ kind: "service", id: row.identity.resourceId });

/** Durable provider intent and recovery state. No provider call occurs inside this journal. */
export class ProviderOperations {
  constructor(sql, tasks, services) {
    this.sql = sql;
    this.tasks = tasks;
    this.services = services;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS provider_operations (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL)",
    );
  }
  entries() {
    return this.sql
      .exec("SELECT body FROM provider_operations")
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  write(row) {
    this.sql.exec(
      "INSERT OR REPLACE INTO provider_operations (id, task_id, body) VALUES (?, ?, ?)",
      row.id,
      row.taskId,
      JSON.stringify(row),
    );
  }
  get(id) {
    const row = this.sql
      .exec("SELECT body FROM provider_operations WHERE id = ?", id)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  task(id) {
    return this.tasks.records().find((task) => task.id === id);
  }
  heldTasks() {
    return new Set(
      this.entries()
        .filter(pending)
        .map((row) => row.taskId),
    );
  }
  awaiting(taskId) {
    return this.entries().some(
      (row) => row.taskId === taskId && pending(row) && row.nextAt !== null,
    );
  }

  begin(claimed, publication, inputDigest, now) {
    let task = this.task(claimed.id);
    if (!hasCurrentClaim(task, claimed, now)) return null;
    if (task.stepId !== "host")
      throw new Error("Service publication requires the trusted host step.");
    if (
      publication.identity.ownerId !== task.ownerId ||
      publication.identity.projectId !== task.input.projectId ||
      publication.identity.taskId !== task.id ||
      publication.identity.expiresAt !== task.deadlineAt
    )
      throw new Error("Provider intent does not belong to this saved task.");
    const previous = this.entries().filter(
      (row) => row.taskId === task.id && row.stepId === task.stepId,
    );
    if (
      previous.some(
        (row) =>
          row.identity.packageDigest !== publication.identity.packageDigest ||
          row.identity.reportDigest !== publication.identity.reportDigest,
      )
    )
      throw new Error("The publication step's source is already frozen.");
    const retained = previous.find(
      (row) => pending(row) || row.outcome === "completed",
    );
    if (retained) return retained;
    const identity = publication.identity;
    const key = `${task.id}_${identity.operationId}`;
    const existing = this.get(key);
    if (existing) {
      if (!sameServiceIdentity(existing.identity, identity))
        throw new Error("Provider operation identity conflicts.");
      return existing;
    }
    this.services.intent(task, publication, now);
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
        id: identity.operationId,
        stepId: task.stepId,
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
      id: key,
      taskId: task.id,
      stepId: task.stepId,
      identity,
      inputDigest,
      publication,
      generation: task.generation,
      claimId: task.claim.id,
      dispatched: false,
      settled: false,
      hadResource: false,
      outcome: null,
      cancelRequested: false,
      cancelled: false,
      attempts: 0,
      nextAt: task.claim.expiresAt,
    };
    this.tasks.save(task, revision);
    this.write(row);
    return row;
  }

  dispatch(claimed, id, now) {
    const row = this.get(id);
    if (
      !row ||
      row.dispatched ||
      row.settled ||
      !hasCurrentClaim(this.task(claimed.id), claimed, now)
    )
      return false;
    row.dispatched = true;
    this.write(row);
    return true;
  }

  uncertain(claimed, id, now) {
    const row = this.get(id);
    if (!row || row.settled) return;
    let task = this.task(row.taskId);
    const revision = task.revision;
    if (hasCurrentClaim(task, claimed, now)) {
      const operation = task.operations.find(
        (item) => item.id === row.identity.operationId,
      );
      task = transitionTask(
        task,
        {
          kind: "record_operation",
          operation: { ...operation, status: "unknown", updatedAt: now },
        },
        transitionGuard(task, now, taskClaim(task)),
      );
      task = transitionTask(
        task,
        {
          kind: "fail",
          failure: { code: "reconciliation_required", stepId: row.stepId },
        },
        transitionGuard(task, now, taskClaim(task)),
      );
      this.tasks.save(task, revision);
    }
    row.nextAt = now;
    this.write(row);
  }

  noteTerminal(now) {
    const tasks = new Map(this.tasks.records().map((task) => [task.id, task]));
    for (const row of this.entries()) {
      const task = tasks.get(row.taskId);
      if (!task || row.cancelRequested || row.cancelled) continue;
      if (
        task.state !== "stopped" &&
        !(now >= task.deadlineAt && task.state !== "ready")
      )
        continue;
      this.write({ ...row, cancelRequested: true, attempts: 0, nextAt: now });
    }
  }
  due(now) {
    return this.entries().filter((row) => {
      const task = this.task(row.taskId);
      return (
        pending(row) &&
        row.nextAt !== null &&
        row.nextAt <= now &&
        !(task?.state === "running" && task.claim.expiresAt > now)
      );
    });
  }
  nextWakeup() {
    const times = this.entries().flatMap((row) => {
      const task = this.task(row.taskId);
      // Failed tasks still owe cleanup at their deadline, even after normal
      // lookup retries have ended. Retention is a separate, later deadline.
      const deadline =
        task && task.state !== "ready" && !row.cancelRequested && !row.cancelled
          ? [task.deadlineAt]
          : [];
      if (!pending(row) || row.nextAt === null) return deadline;
      return [
        ...deadline,
        task?.state === "running"
          ? Math.max(row.nextAt, task.claim.expiresAt)
          : row.nextAt,
      ];
    });
    return times.length ? Math.min(...times) : null;
  }
  failedLookup(id, now) {
    const row = this.get(id);
    if (!row || !pending(row)) return;
    const attempts = row.attempts + 1;
    this.write({
      ...row,
      attempts,
      nextAt: attempts < 5 ? now + 60000 * 2 ** (attempts - 1) : null,
    });
  }

  observe(id, observation, now) {
    let row = this.get(id);
    if (!row || !pending(row)) return row;
    if (!sameServiceIdentity(row.identity, observation.identity))
      throw new Error("Provider observation belongs to a different service.");
    let task = this.task(row.taskId);
    if (!task) throw new Error("Provider journal lost its retained task.");
    const claimed = { generation: row.generation, claim: { id: row.claimId } };
    const current = hasCurrentClaim(task, claimed, now);
    if (task.state === "running" && !current && now < task.claim.expiresAt) {
      this.write({ ...row, nextAt: task.claim.expiresAt });
      return row;
    }
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
    row = {
      ...row,
      hadResource: row.hadResource || observation.state === "available",
    };
    if (observation.state === "missing") row.cancelRequested = true;
    if (task.state === "stopped" || now >= task.deadlineAt)
      row.cancelRequested = true;
    const complete =
      observation.state === "deleted" ||
      (observation.state === "available" && !row.cancelRequested);
    if (!row.settled) {
      const prior = task.operations.find(
        (item) => item.id === row.identity.operationId,
      );
      const operation = {
        ...prior,
        updatedAt: now,
        status: complete
          ? row.hadResource
            ? "completed"
            : "absent"
          : "unknown",
        resources: row.hadResource ? [resource(row)] : [],
      };
      apply({
        kind: current ? "record_operation" : "reconcile_operation",
        operation,
      });
      if (complete) {
        apply({
          kind: current ? "settle_usage" : "reconcile_usage",
          ...(!current ? { operationId: operation.id } : {}),
          modelTurns: 0,
          toolCalls: 1,
          consumed: row.dispatched,
        });
        row.settled = true;
        row.outcome = operation.status;
        row.publication = null;
      }
    }
    if (
      observation.state === "deleted" ||
      (observation.state === "available" && !row.cancelRequested)
    )
      this.services.observe(row.identity, observation.state, now);
    if (observation.state === "deleted") row.cancelled = true;
    row.nextAt = pending(row) ? now : null;
    if (task.revision !== revision) this.tasks.save(task, revision);
    this.write(row);
    return row;
  }

  prune() {
    const tasks = new Set(this.tasks.records().map((task) => task.id));
    for (const row of this.entries())
      if (!pending(row) && !tasks.has(row.taskId))
        this.sql.exec("DELETE FROM provider_operations WHERE id = ?", row.id);
  }
}
