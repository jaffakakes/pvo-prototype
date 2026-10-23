import { transitionTask } from "../../../packages/pvo-assistant/tasks/index.js";
import {
  parseBuilderResearchResult,
  serializeBuilderResearch,
} from "../../../packages/pvo-assistant/builder/index.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "../tasks/executionClaim.js";

/** Durable read-only research intent/results and usage; no workspace or provider credentials. */
export class TaskResearch {
  constructor(sql, tasks) {
    this.sql = sql;
    this.tasks = tasks;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS task_research (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS task_research_task ON task_research(task_id)",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS task_research_unfinished ON task_research(task_id) WHERE json_extract(body,'$.settled')=0",
    );
  }
  unfinished() {
    return this.sql
      .exec(
        "SELECT body FROM task_research WHERE json_extract(body,'$.settled')=0",
      )
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  entries() {
    return this.sql
      .exec("SELECT body FROM task_research")
      .toArray()
      .map((row) => JSON.parse(row.body));
  }
  get(taskId, operationId) {
    const row = this.sql
      .exec(
        "SELECT body FROM task_research WHERE id=?",
        `${taskId}_${operationId}`,
      )
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }

  write(row) {
    this.sql.exec(
      "INSERT INTO task_research (id,task_id,body) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      row.id,
      row.taskId,
      JSON.stringify(row),
    );
  }
  task(id) {
    return this.tasks.records().find((task) => task.id === id);
  }
  begin(claimed, operationId, tool, inputDigest, now) {
    let task = this.task(claimed.id);
    if (!hasCurrentClaim(task, claimed, now)) return null;
    if (task.stepId !== "build")
      throw new Error("Research requires a build claim.");
    if (task.questions.some((question) => question.answer === null)) {
      const saved = this.sql
        .exec("SELECT body FROM task_builders WHERE task_id=?", task.id)
        .toArray()[0];
      const state = saved ? JSON.parse(saved.body) : null;
      const expected =
        state?.decision?.kind === "ask_research"
          ? state.decision.calls[state.cursor]
          : null;
      if (
        operationId !== `build-${state?.round}-${state?.cursor}` ||
        !expected ||
        serializeBuilderResearch(expected) !== serializeBuilderResearch(tool)
      )
        throw new Error(
          "Only the saved independent research may run while an answer is pending.",
        );
    }
    const prior = this.get(task.id, operationId);
    if (prior) {
      if (prior.inputDigest !== inputDigest)
        throw new Error("Research operation input conflicts.");
      return prior;
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
        stepId: "build",
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
      id: `${task.id}_${operationId}`,
      taskId: task.id,
      operationId,
      tool,
      inputDigest,
      claim: taskClaim(task),
      deadlineAt: task.claim.expiresAt,
      dispatched: false,
      settled: false,
      result: null,
    };
    this.tasks.save(task, revision);
    this.write(row);
    return row;
  }
  dispatch(claimed, operationId, now) {
    const row = this.get(claimed.id, operationId);
    if (
      !row ||
      row.dispatched ||
      row.settled ||
      !hasCurrentClaim(this.task(claimed.id), claimed, now)
    )
      return false;
    this.write({ ...row, dispatched: true });
    return true;
  }
  finish(taskId, operationId, value, now) {
    const row = this.get(taskId, operationId);
    if (!row || row.settled) return row;
    const result = parseBuilderResearchResult(row.tool, value);
    let task = this.task(taskId);
    if (!task) throw new Error("Research lost its retained task.");
    const current = hasCurrentClaim(
      task,
      { claim: { id: row.claim.id }, generation: row.claim.generation },
      now,
    );
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
    const prior = task.operations.find((item) => item.id === operationId);
    apply({
      kind: current ? "record_operation" : "reconcile_operation",
      operation: {
        ...prior,
        status: row.dispatched
          ? result.status === "unknown"
            ? "failed"
            : "completed"
          : "absent",
        failure:
          row.dispatched && result.status === "unknown"
            ? { code: "interrupted", stepId: "build" }
            : null,
        updatedAt: now,
      },
    });
    apply({
      kind: current ? "settle_usage" : "reconcile_usage",
      ...(!current ? { operationId } : {}),
      modelTurns: 0,
      toolCalls: 1,
      consumed: row.dispatched,
    });
    this.tasks.save(task, revision);
    const settled = { ...row, settled: true, result };
    this.write(settled);
    return settled;
  }
  recover(now) {
    for (const row of this.unfinished()) {
      const task = this.task(row.taskId);
      if (task?.state === "running" && task.claim.expiresAt > now) continue;
      this.finish(
        row.taskId,
        row.operationId,
        { kind: row.tool.kind, status: "unknown", result: null },
        now,
      );
    }
  }
  nextWakeup(now) {
    const times = this.unfinished().map((row) =>
      this.task(row.taskId)?.state === "running" ? row.deadlineAt : now,
    );
    return times.length ? Math.min(...times) : null;
  }
  prune(now) {
    this.sql.exec(
      `DELETE FROM task_research
      WHERE json_extract(body,'$.settled')=1 AND NOT EXISTS (
        SELECT 1 FROM tasks WHERE tasks.id=task_research.task_id AND record IS NOT NULL
        AND (json_extract(record,'$.expiresAt') IS NULL OR json_extract(record,'$.expiresAt')>?)
      )`,
      now,
    );
  }
}
