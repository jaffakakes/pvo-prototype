import {
  createTask,
  parseTaskRecord,
  replayTaskCreation,
  transitionTask,
} from "../../../packages/pvo-assistant/tasks/index.js";
import { TaskOperationHistory } from "./operationHistory.js";
import { TaskQuestionHistory } from "./questionHistory.js";
import { HttpError } from "../../http.js";
import { TASK_STORAGE_LIMITS as limits } from "./input.js";

const unfinished = (task) =>
  ["queued", "running", "waiting_for_answer", "waiting"].includes(task.state);
const unsettled = (task) =>
  task.operations.some((operation) =>
    ["planned", "unknown"].includes(operation.status),
  ) ||
  task.usage.reservedModelTurns > 0 ||
  task.usage.reservedToolCalls > 0;

/** Synchronous SQLite adapter. The coordinator owns each enclosing transaction. */
export class TaskRepository {
  constructor(sql) {
    this.sql = sql;
    this.history = new TaskOperationHistory(sql);
    this.questions = new TaskQuestionHistory(sql);
    sql.exec(`CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK (id = 1), owner_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, local_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL, created_at INTEGER NOT NULL, record TEXT);
      CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id, id);
      CREATE INDEX IF NOT EXISTS tasks_created ON tasks(created_at);`);
  }

  bindOwner(ownerId) {
    const owner = this.sql
      .exec("SELECT owner_id FROM owner WHERE id = 1")
      .toArray()[0];
    if (owner && owner.owner_id !== ownerId)
      throw new HttpError(404, "This task is unavailable.");
    if (!owner)
      this.sql.exec("INSERT INTO owner (id, owner_id) VALUES (1, ?)", ownerId);
  }

  project(localId, id, now) {
    const current = this.sql
      .exec("SELECT id FROM projects WHERE local_id = ?", localId)
      .toArray()[0];
    if (current) return { id: current.id };
    if (
      this.sql.exec("SELECT COUNT(*) AS count FROM projects").one().count >=
      limits.projects
    )
      throw new HttpError(429, "Your saved project limit has been reached.");
    this.sql.exec(
      "INSERT INTO projects (id, local_id, created_at) VALUES (?, ?, ?)",
      id,
      localId,
      now,
    );
    return { id };
  }

  requireProject(id) {
    if (
      !this.sql.exec("SELECT id FROM projects WHERE id = ?", id).toArray()
        .length
    )
      throw new HttpError(404, "This project is unavailable.");
  }

  records() {
    return this.sql
      .exec("SELECT record FROM tasks WHERE record IS NOT NULL")
      .toArray()
      .map((row) => parseTaskRecord(JSON.parse(row.record)));
  }

  read(id, now) {
    const row = this.sql
      .exec("SELECT record FROM tasks WHERE id = ?", id)
      .toArray()[0];
    const task = row?.record ? parseTaskRecord(JSON.parse(row.record)) : null;
    if (!task || (task.expiresAt !== null && task.expiresAt <= now))
      throw new HttpError(404, "This task is unavailable.");
    return task;
  }

  create(input, metadata) {
    this.requireProject(input.projectId);
    const row = this.sql
      .exec(
        "SELECT record FROM tasks WHERE operation_id = ?",
        input.operationId,
      )
      .toArray()[0];
    if (row) {
      if (
        !row.record ||
        (JSON.parse(row.record).expiresAt !== null &&
          JSON.parse(row.record).expiresAt <= metadata.now)
      )
        throw new HttpError(
          410,
          "This task has expired. Start a new request to continue.",
        );
      try {
        return {
          task: replayTaskCreation(JSON.parse(row.record), input, {
            ownerId: metadata.ownerId,
            inputDigest: metadata.inputDigest,
          }),
          created: false,
        };
      } catch {
        throw new HttpError(
          409,
          "This creation identity was already used for a different task request.",
        );
      }
    }
    const records = this.records();
    const count = this.sql
      .exec("SELECT COUNT(*) AS count FROM tasks")
      .one().count;
    const day = Math.floor(metadata.now / 86400000) * 86400000;
    const daily = this.sql
      .exec("SELECT COUNT(*) AS count FROM tasks WHERE created_at >= ?", day)
      .one().count;
    if (
      records.length >= limits.retained ||
      records.filter(unfinished).length >= limits.active ||
      daily >= limits.daily ||
      count >= limits.identities
    )
      throw new HttpError(
        429,
        "Your saved task limit has been reached. Stop unfinished work or try again later.",
      );
    const task = createTask(input, metadata);
    this.sql.exec(
      "INSERT INTO tasks (id, operation_id, project_id, created_at, record) VALUES (?, ?, ?, ?, ?)",
      task.id,
      input.operationId,
      input.projectId,
      task.createdAt,
      JSON.stringify(task),
    );
    return { task, created: true };
  }

  list({ projectId, before, limit }, now) {
    this.requireProject(projectId);
    const tasks = this.sql
      .exec(
        `SELECT record FROM tasks WHERE project_id = ? AND record IS NOT NULL
      AND (? IS NULL OR id < ?) ORDER BY id DESC`,
        projectId,
        before,
        before,
      )
      .toArray()
      .map((row) => parseTaskRecord(JSON.parse(row.record)))
      .filter((task) => task.expiresAt === null || task.expiresAt > now);
    return {
      tasks: tasks.slice(0, limit),
      next: tasks.length > limit ? tasks[limit - 1].id : null,
    };
  }

  update(id, command, guard) {
    const task = this.read(id, guard.now);
    if (task.ownerId !== guard.ownerId)
      throw new HttpError(404, "This task is unavailable.");
    if (command.kind === "resume" && unsettled(task))
      throw new HttpError(
        409,
        "This task needs its interrupted work reconciled before resuming.",
      );
    if (
      command.kind === "resume" &&
      !unfinished(task) &&
      this.records().filter(unfinished).length >= limits.active
    )
      throw new HttpError(
        429,
        "Stop unfinished work before resuming another task.",
      );
    let next;
    try {
      const archived = ["record_operation", "reconcile_operation"].includes(
        command.kind,
      )
        ? this.history.get(task.id, command.operation?.id)
        : null;
      if (archived) {
        // Validate an exact immutable replay through the same domain rules. The
        // temporary view is never stored and cannot replace current unknown work.
        transitionTask({ ...task, operations: [archived] }, command, guard);
        return task;
      }
      if (command.kind === "answer") {
        const answered = this.questions.answer(task.id, command.operationId);
        const question = this.questions.get(task.id, command.questionId);
        if (answered || question) {
          if (!question || answered?.id !== question.id)
            throw new Error("Archived answer identity conflicts.");
          transitionTask(
            { ...task, questions: [...task.questions, question] },
            command,
            guard,
          );
          return task;
        }
      }
      next = transitionTask(task, command, guard);
    } catch {
      throw new HttpError(
        409,
        "The task changed or cannot perform this operation. Refresh its saved state.",
      );
    }
    this.save(next, task.revision);
    return next;
  }

  save(task, expectedRevision) {
    const row = this.sql
      .exec("SELECT record FROM tasks WHERE id=?", task.id)
      .toArray()[0];
    const before = row?.record ? parseTaskRecord(JSON.parse(row.record)) : null;
    if (!before || before.revision !== expectedRevision)
      throw new HttpError(409, "The task changed. Refresh its saved state.");
    this.history.archive(before, task);
    this.questions.archive(before, task);
    const changed = this.sql.exec(
      `UPDATE tasks SET record = ? WHERE id = ?
      AND json_extract(record, '$.revision') = ?`,
      JSON.stringify(task),
      task.id,
      expectedRevision,
    ).rowsWritten;
    if (changed !== 1)
      throw new HttpError(409, "The task changed. Refresh its saved state.");
  }

  maintain(now, heldTasks = new Set()) {
    for (const task of this.records()) {
      // Keep uncertain effect bookkeeping until its adapter has reconciled it.
      if (
        task.expiresAt !== null &&
        task.expiresAt <= now &&
        !unsettled(task) &&
        !heldTasks.has(task.id)
      ) {
        this.history.remove(task.id);
        this.questions.remove(task.id);
        this.sql.exec("UPDATE tasks SET record = NULL WHERE id = ?", task.id);
      }
    }
  }

  nextMaintenance(now) {
    const times = this.records().flatMap((task) => [
      ...(task.expiresAt !== null && task.expiresAt > now
        ? [task.expiresAt]
        : []),
    ]);
    return times.length ? Math.min(...times) : null;
  }
}
