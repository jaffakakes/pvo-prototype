import { transitionTask } from "../../../packages/pvo-assistant/tasks/index.js";
import {
  serializeWorkspaceIdentity,
  workspaceTaskCleanup,
} from "../../../packages/pvo-assistant/workspaces/index.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "./executionClaim.js";

const waiting = (link) => link.mode !== null && !link.cleaned;

/** Task-owned workspace links and operation accounting; provider effects live in the runner. */
export class WorkspaceOperations {
  constructor(sql, tasks) {
    this.sql = sql;
    this.tasks = tasks;
    sql.exec(`CREATE TABLE IF NOT EXISTS task_workspaces (task_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_operations (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL)`);
  }
  links() {
    return this.sql
      .exec("SELECT body FROM task_workspaces")
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  entries() {
    return this.sql
      .exec("SELECT body FROM workspace_operations")
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  task(id) {
    return this.tasks.records().find((task) => task.id === id);
  }
  link(taskId) {
    return this.links().find((link) => link.taskId === taskId) ?? null;
  }
  get(id) {
    const row = this.sql
      .exec("SELECT body FROM workspace_operations WHERE id=?", id)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  saveLink(link) {
    this.sql.exec(
      "INSERT INTO task_workspaces (task_id,body) VALUES (?,?) ON CONFLICT(task_id) DO UPDATE SET body=excluded.body",
      link.taskId,
      JSON.stringify(link),
    );
  }
  write(row) {
    this.sql.exec(
      "INSERT INTO workspace_operations (id,task_id,body) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      row.id,
      row.taskId,
      JSON.stringify(row),
    );
  }
  heldTasks() {
    return new Set([
      ...this.entries()
        .filter((row) => !row.settled)
        .map((row) => row.taskId),
      ...this.links()
        .filter(waiting)
        .map((link) => link.taskId),
    ]);
  }
  awaiting(taskId) {
    const link = this.link(taskId);
    return (
      this.entries().some(
        (row) => row.taskId === taskId && !row.settled && row.nextAt !== null,
      ) || Boolean(link && waiting(link) && link.nextAt !== null)
    );
  }

  begin(claimed, identity, kind, operationId, inputDigest, now) {
    let task = this.task(claimed.id);
    if (!hasCurrentClaim(task, claimed, now)) return null;
    if (task.stepId !== "build")
      throw new Error("Workspace operations require the build step.");
    if (
      identity.ownerId !== task.ownerId ||
      identity.projectId !== task.input.projectId ||
      identity.taskId !== task.id
    )
      throw new Error("Workspace intent does not belong to its saved task.");
    const id = `${task.id}_${operationId}`;
    const prior = this.get(id);
    if (prior) {
      if (
        prior.kind !== kind ||
        prior.inputDigest !== inputDigest ||
        serializeWorkspaceIdentity(prior.identity) !==
          serializeWorkspaceIdentity(identity)
      )
        throw new Error("Workspace operation input conflicts.");
      return prior;
    }
    const link = this.link(task.id);
    if (
      link &&
      (waiting(link) ||
        serializeWorkspaceIdentity(link.identity) !==
          serializeWorkspaceIdentity(identity))
    )
      throw new Error("Workspace ownership or cleanup needs reconciliation.");
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
    const grant = {
      id: task.claim.id,
      generation: task.generation,
      expiresAt: task.claim.expiresAt,
    };
    const row = {
      id,
      taskId: task.id,
      operationId,
      stepId: task.stepId,
      identity,
      kind,
      inputDigest,
      grant,
      dispatched: false,
      settled: false,
      receipt: null,
      attempts: 0,
      nextAt: task.claim.expiresAt,
    };
    this.tasks.save(task, revision);
    this.write(row);
    this.saveLink({
      taskId: task.id,
      identity,
      grant,
      mode: null,
      cleaned: false,
      attempts: 0,
      nextAt: null,
    });
    return row;
  }
  dispatch(claimed, id, now) {
    const row = this.get(id);
    if (
      !row ||
      row.dispatched ||
      row.settled ||
      !hasCurrentClaim(this.task(row.taskId), claimed, now)
    )
      return false;
    this.write({ ...row, dispatched: true });
    return true;
  }
  uncertain(claimed, id, now) {
    const row = this.get(id);
    if (!row || row.settled) return;
    let task = this.task(row.taskId);
    if (hasCurrentClaim(task, claimed, now)) {
      const revision = task.revision;
      const operation = task.operations.find(
        (item) => item.id === row.operationId,
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
    this.write({ ...row, nextAt: now });
    this.noteTerminal(now);
  }
  observe(id, receipt, now) {
    const row = this.get(id);
    if (!row || row.settled) return row;
    if (
      receipt &&
      (receipt.id !== row.operationId ||
        receipt.kind !== row.kind ||
        receipt.digest !== row.inputDigest ||
        receipt.status === "pending")
    )
      throw new Error(
        "Workspace receipt does not settle its recorded operation.",
      );
    let task = this.task(row.taskId);
    if (!task) throw new Error("Workspace operation lost its retained task.");
    const claimed = {
      claim: { id: row.grant.id },
      generation: row.grant.generation,
    };
    const current = hasCurrentClaim(task, claimed, now);
    if (task.state === "running" && !current && now < task.claim.expiresAt)
      return row;
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
    const prior = task.operations.find((item) => item.id === row.operationId);
    const failed = receipt?.status === "interrupted";
    apply({
      kind: current ? "record_operation" : "reconcile_operation",
      operation: {
        ...prior,
        status: receipt ? (failed ? "failed" : "completed") : "absent",
        resources: receipt
          ? [{ kind: "workspace", id: row.identity.resourceId }]
          : [],
        failure: failed ? { code: "interrupted", stepId: row.stepId } : null,
        updatedAt: now,
      },
    });
    apply({
      kind: current ? "settle_usage" : "reconcile_usage",
      ...(!current ? { operationId: row.operationId } : {}),
      modelTurns: 0,
      toolCalls: 1,
      consumed: row.dispatched,
    });
    this.tasks.save(task, revision);
    const settled = {
      ...row,
      settled: true,
      receipt,
      attempts: 0,
      nextAt: null,
    };
    this.write(settled);
    return settled;
  }

  noteTerminal(now) {
    for (const link of this.links()) {
      const task = this.task(link.taskId);
      const mode = workspaceTaskCleanup(task, link.grant, now);
      if (!mode || link.mode === "stop" || link.mode === mode) continue;
      this.saveLink({
        ...link,
        mode,
        cleaned: false,
        attempts: 0,
        nextAt: now,
      });
    }
  }
  cleanupDue(now) {
    return this.links().filter(
      (link) => waiting(link) && link.nextAt !== null && link.nextAt <= now,
    );
  }
  observeCleanup(candidate, observation, now) {
    const link = this.link(candidate.taskId);
    if (
      !link ||
      !waiting(link) ||
      link.mode !== candidate.mode ||
      link.grant.generation !== candidate.grant.generation
    )
      return;
    const revoked =
      link.mode === "stop"
        ? observation.closed
        : observation.closed ||
          observation.revokedThrough >= link.grant.generation;
    if (
      !revoked ||
      observation.cleanupRequired ||
      observation.active !== null ||
      observation.lease !== null
    )
      throw new Error("Workspace cleanup is not confirmed.");
    this.saveLink({ ...link, cleaned: true, nextAt: null });
    for (const row of this.entries())
      if (row.taskId === link.taskId && !row.settled)
        this.write({ ...row, nextAt: now });
  }
  cleanupFailed(candidate, now) {
    const link = this.link(candidate.taskId);
    if (
      !link ||
      !waiting(link) ||
      link.mode !== candidate.mode ||
      link.grant.generation !== candidate.grant.generation
    )
      return;
    const attempts = link.attempts + 1;
    this.saveLink({
      ...link,
      attempts,
      nextAt: attempts < 5 ? now + 60000 * 2 ** (attempts - 1) : null,
    });
  }
  due(now) {
    return this.entries().filter((row) => {
      const task = this.task(row.taskId),
        link = this.link(row.taskId);
      return (
        !row.settled &&
        row.nextAt !== null &&
        row.nextAt <= now &&
        link?.cleaned &&
        !(task?.state === "running" && task.claim.expiresAt > now)
      );
    });
  }
  failedLookup(id, now) {
    const row = this.get(id);
    if (!row || row.settled) return;
    const attempts = row.attempts + 1;
    this.write({
      ...row,
      attempts,
      nextAt: attempts < 5 ? now + 60000 * 2 ** (attempts - 1) : null,
    });
  }
  nextWakeup() {
    const times = this.links().flatMap((link) => [
      ...(waiting(link)
        ? link.nextAt === null
          ? []
          : [link.nextAt]
        : !link.cleaned
          ? [link.grant.expiresAt]
          : []),
    ]);
    for (const row of this.entries())
      if (!row.settled && row.nextAt !== null) {
        const task = this.task(row.taskId),
          link = this.link(row.taskId);
        // While cleanup is pending it alone owns the next wakeup. Avoid a past-due receipt loop.
        if (link && waiting(link)) continue;
        times.push(
          task?.state === "running"
            ? Math.max(row.nextAt, task.claim.expiresAt)
            : row.nextAt,
        );
      }
    return times.length ? Math.min(...times) : null;
  }
  prune(now) {
    const tasks = new Map(this.tasks.records().map((task) => [task.id, task]));
    for (const row of this.entries()) {
      const task = tasks.get(row.taskId);
      if (task?.expiresAt !== null && task?.expiresAt <= now && row.receipt)
        this.write({ ...row, receipt: null });
      if (row.settled && !tasks.has(row.taskId))
        this.sql.exec("DELETE FROM workspace_operations WHERE id=?", row.id);
    }
    for (const link of this.links())
      if (link.cleaned && !tasks.has(link.taskId))
        this.sql.exec(
          "DELETE FROM task_workspaces WHERE task_id=?",
          link.taskId,
        );
  }
}
