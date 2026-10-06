import { boundedText } from "./repairFeedback.js";

/** Private failed-proposal evidence, committed with the inference receipt and repair transition. */
export class TaskRepairs {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS task_repairs (
      task_id TEXT NOT NULL, operation_id TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY(task_id,operation_id))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS task_repair_cursor (
      task_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL)`);
  }

  current(taskId) {
    const row = this.sql
      .exec(
        `SELECT r.rowid AS sequence,r.body FROM task_repairs r
      JOIN task_repair_cursor c ON c.task_id=r.task_id AND c.operation_id=r.operation_id
      WHERE r.task_id=?`,
        taskId,
      )
      .toArray()[0];
    return row ? { sequence: row.sequence, ...JSON.parse(row.body) } : null;
  }

  context(task) {
    const record = this.current(task.id);
    if (!record || record.stepId !== task.stepId) return null;
    const { text, truncated } = boundedText(record.proposal.text, 4096);
    return {
      sequence: record.sequence,
      stepId: record.stepId,
      check: record.check,
      message: record.message,
      repetitions: record.repetitions,
      proposal: { text, truncated: truncated || record.proposal.truncated },
      historyCollection: "repairs",
    };
  }

  prepare(task, attempt, feedback, now) {
    const previous = this.current(task.id);
    // A new creator answer allows another repair. Reading history is not evidence of a fix.
    const answers =
      task.archivedQuestions +
      task.questions.filter((q) => q.answer !== null).length;
    const repeated =
      previous?.stepId === task.stepId &&
      previous.answers === answers &&
      previous.check === feedback.check &&
      previous.message === feedback.message &&
      !previous.proposal.truncated &&
      !feedback.proposal.truncated &&
      previous.proposal.text === feedback.proposal.text;
    const record = {
      ...feedback,
      operationId: attempt.operationId,
      stepId: task.stepId,
      answers,
      repetitions: repeated ? previous.repetitions + 1 : 1,
      createdAt: now,
    };
    const command =
      record.repetitions < 3
        ? { kind: "checkpoint", stepId: task.stepId }
        : {
            kind: "ask",
            question: {
              id: `repair-help-${task.generation}`,
              revision: 0,
              prompt: helpPrompt(task.stepId, feedback.check),
              choices: ["Keep repairing", "I'll clarify the request"],
              answer: null,
            },
          };
    return { record, command };
  }

  save(taskId, record) {
    this.sql.exec(
      "INSERT INTO task_repairs(task_id,operation_id,body) VALUES(?,?,?)",
      taskId,
      record.operationId,
      JSON.stringify(record),
    );
    this.sql.exec(
      `INSERT INTO task_repair_cursor(task_id,operation_id) VALUES(?,?)
      ON CONFLICT(task_id) DO UPDATE SET operation_id=excluded.operation_id`,
      taskId,
      record.operationId,
    );
  }

  clear(taskId) {
    this.sql.exec("DELETE FROM task_repair_cursor WHERE task_id=?", taskId);
  }

  prune() {
    for (const table of ["task_repairs", "task_repair_cursor"])
      this.sql.exec(
        `DELETE FROM ${table} WHERE task_id IN (SELECT id FROM tasks WHERE record IS NULL)`,
      );
  }
}

function helpPrompt(stepId, check) {
  if (check === "attachment_evidence")
    return "I keep failing to verify the component's hosted connection. Choose Keep repairing to retry the connection checks, or tell me which part of the requested connection can change.";
  if (stepId === "attach")
    return "The component keeps failing the same validation check. Choose Keep repairing to try another approach, or describe a simpler form or button interaction I can use.";
  if (stepId === "build")
    return "The backend plan keeps failing the same validation check. Choose Keep repairing to try another approach, or describe the most important action and its expected result.";
  return "I keep failing to produce a valid plan. Choose Keep repairing to try again, or clarify the main action you want this component to perform.";
}
