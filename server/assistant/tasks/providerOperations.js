import { transitionTask } from "../../../packages/pvo-assistant/tasks/index.js";
import { sameServiceIdentity } from "../../../packages/pvo-assistant/releases/index.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "./executionClaim.js";

const pending = (row) =>
  !row.settled || (row.cancelRequested && !row.cancelled && !row.retained);
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
    sql.exec(
      "CREATE INDEX IF NOT EXISTS provider_operations_task ON provider_operations(task_id,json_extract(body,'$.stepId'))",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS provider_operations_pending ON provider_operations(task_id) WHERE json_extract(body,'$.settled')=0 OR (json_extract(body,'$.cancelRequested')=1 AND json_extract(body,'$.cancelled')=0 AND json_extract(body,'$.retained')=0)",
    );
  }
  pendingEntries() {
    return this.sql
      .exec(
        `SELECT body FROM provider_operations WHERE json_extract(body,'$.settled')=0 OR
      (json_extract(body,'$.cancelRequested')=1 AND json_extract(body,'$.cancelled')=0 AND json_extract(body,'$.retained')=0)`,
      )
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  completed(taskId, releaseId = null) {
    // Two rows are enough to reject ambiguity; never hydrate every historic release.
    return this.sql
      .exec(
        `SELECT body FROM provider_operations WHERE task_id=?
      AND json_extract(body,'$.settled')=1 AND json_extract(body,'$.outcome')='completed'
      AND json_extract(body,'$.cancelled')=0
      AND (json_extract(body,'$.cancelRequested')=0 OR json_extract(body,'$.retained')=1)
      AND (? IS NULL OR json_extract(body,'$.identity.resourceId')=?) ORDER BY rowid LIMIT 2`,
        taskId,
        releaseId,
        releaseId,
      )
      .toArray()
      .map((row) => JSON.parse(row.body));
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
    return new Set(this.pendingEntries().map((row) => row.taskId));
  }
  awaiting(taskId) {
    return this.pendingEntries().some(
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
      publication.identity.taskId !== task.id
    )
      throw new Error("Provider intent does not belong to this saved task.");
    const changed = this.sql
      .exec(
        `SELECT 1 FROM provider_operations WHERE task_id=? AND json_extract(body,'$.stepId')=?
      AND (json_extract(body,'$.identity.packageDigest')<>? OR json_extract(body,'$.identity.reportDigest')<>?) LIMIT 1`,
        task.id,
        task.stepId,
        publication.identity.packageDigest,
        publication.identity.reportDigest,
      )
      .toArray().length;
    if (changed)
      throw new Error("The publication step's source is already frozen.");
    const retained = this.sql
      .exec(
        `SELECT body FROM provider_operations WHERE task_id=? AND json_extract(body,'$.stepId')=?
      AND (json_extract(body,'$.settled')=0 OR json_extract(body,'$.outcome')='completed' OR
        (json_extract(body,'$.cancelRequested')=1 AND json_extract(body,'$.cancelled')=0 AND json_extract(body,'$.retained')=0))
      ORDER BY rowid LIMIT 1`,
        task.id,
        task.stepId,
      )
      .toArray()[0];
    if (retained) return JSON.parse(retained.body);
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
      retained: false,
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
    this.sql.exec(
      `UPDATE provider_operations SET body=json_set(body,'$.cancelRequested',json('true'),'$.attempts',0,'$.nextAt',?)
      WHERE json_extract(body,'$.cancelRequested')=0 AND json_extract(body,'$.cancelled')=0 AND json_extract(body,'$.retained')=0
      AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id=provider_operations.task_id AND record IS NOT NULL
        AND (json_extract(record,'$.state')='stopped' OR json_extract(provider_operations.body,'$.identity.expiresAt')<=?))`,
      now,
      now,
    );
  }
  due(now) {
    return this.sql
      .exec(
        `SELECT p.body FROM provider_operations p LEFT JOIN tasks t ON t.id=p.task_id
      WHERE (json_extract(p.body,'$.settled')=0 OR (json_extract(p.body,'$.cancelRequested')=1 AND json_extract(p.body,'$.cancelled')=0 AND json_extract(p.body,'$.retained')=0))
      AND json_extract(p.body,'$.nextAt')<=?
      AND (t.record IS NULL OR json_extract(t.record,'$.state')<>'running' OR json_extract(t.record,'$.claim.expiresAt')<=?)
      ORDER BY p.rowid LIMIT 2`,
        now,
        now,
      )
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  nextWakeup() {
    // Resource expiry and pending reconciliation each contribute their own wakeup.
    return this.sql
      .exec(
        `SELECT MIN(wakeup) AS next FROM (
      SELECT json_extract(p.body,'$.identity.expiresAt') AS wakeup FROM provider_operations p JOIN tasks t ON t.id=p.task_id
        WHERE t.record IS NOT NULL AND json_extract(p.body,'$.cancelRequested')=0
          AND json_extract(p.body,'$.cancelled')=0 AND json_extract(p.body,'$.retained')=0
      UNION ALL
      SELECT CASE WHEN json_extract(t.record,'$.state')='running'
        THEN MAX(json_extract(p.body,'$.nextAt'),json_extract(t.record,'$.claim.expiresAt'))
        ELSE json_extract(p.body,'$.nextAt') END AS wakeup
        FROM provider_operations p LEFT JOIN tasks t ON t.id=p.task_id
        WHERE json_extract(p.body,'$.settled')=0 OR (json_extract(p.body,'$.cancelRequested')=1
          AND json_extract(p.body,'$.cancelled')=0 AND json_extract(p.body,'$.retained')=0)
    )`,
      )
      .one().next;
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
      hadResource:
        row.hadResource ||
        ["available", "retained"].includes(observation.state),
    };
    if (observation.state === "missing") row.cancelRequested = true;
    if (task.state === "stopped" || now >= row.identity.expiresAt)
      row.cancelRequested = true;
    const complete =
      observation.state === "deleted" ||
      observation.state === "retained" ||
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
      observation.state === "retained" ||
      (observation.state === "available" && !row.cancelRequested)
    )
      this.services.observe(row.identity, observation.state, now);
    if (observation.state === "deleted") row.cancelled = true;
    if (observation.state === "retained") row.retained = true;
    row.nextAt = pending(row) ? now : null;
    if (task.revision !== revision) this.tasks.save(task, revision);
    this.write(row);
    return row;
  }

  prune() {
    this.sql
      .exec(`DELETE FROM provider_operations WHERE json_extract(body,'$.settled')=1
      AND (json_extract(body,'$.cancelRequested')=0 OR json_extract(body,'$.cancelled')=1 OR json_extract(body,'$.retained')=1)
      AND NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.id=provider_operations.task_id AND record IS NOT NULL)`);
  }
}
