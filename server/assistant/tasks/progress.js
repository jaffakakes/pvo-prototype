import { serializeProgressEvidence } from "./progressEvidence.js";

const answers = (task) =>
  task.archivedQuestions +
  task.questions.filter((question) => question.answer !== null).length;

/** Three current evidence cursors per goal; full tool receipts and review reports remain in their owned journals. */
export class TaskProgress {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS task_progress (
      task_id TEXT NOT NULL, channel TEXT NOT NULL, signature TEXT NOT NULL,
      round INTEGER NOT NULL, answers INTEGER NOT NULL, repetitions INTEGER NOT NULL, help_step TEXT NOT NULL,
      PRIMARY KEY(task_id,channel))`);
  }

  observe(task, channel, round, evidence) {
    try {
      this.saveObservation(task, channel, round, evidence);
    } catch {
      throw Object.assign(new Error("Saving execution progress failed."), {
        code: "execution_failed",
      });
    }
  }

  saveObservation(task, channel, round, evidence) {
    if (!evidence) {
      this.clear(task.id, channel);
      return;
    }
    const prior = this.sql
      .exec(
        "SELECT * FROM task_progress WHERE task_id=? AND channel=?",
        task.id,
        channel,
      )
      .toArray()[0];
    // Recovery of the same saved batch/report is not another failed approach.
    if (prior && prior.round >= round) return;
    const signature = serializeProgressEvidence(evidence);
    const count = answers(task);
    const repeated = prior?.answers === count && prior.signature === signature;
    this.sql.exec(
      `INSERT INTO task_progress(task_id,channel,signature,round,answers,repetitions,help_step) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(task_id,channel) DO UPDATE SET signature=excluded.signature,round=excluded.round,answers=excluded.answers,repetitions=excluded.repetitions,help_step=excluded.help_step`,
      task.id,
      channel,
      signature,
      round,
      count,
      repeated ? prior.repetitions + 1 : 1,
      channel === "history" ? task.stepId : "build",
    );
  }

  context(task) {
    return this.sql
      .exec(
        "SELECT channel,round,repetitions FROM task_progress WHERE task_id=? AND answers=? AND help_step=? ORDER BY channel",
        task.id,
        answers(task),
        task.stepId,
      )
      .toArray();
  }

  question(task, round) {
    const stalled = this.context(task).find(
      (item) =>
        (item.channel === "history" || item.round === round) &&
        item.repetitions >= 3,
    );
    if (!stalled) return null;
    return {
      id: `progress-help-${task.generation}`,
      revision: 0,
      prompt:
        stalled.channel === "history"
          ? "The same saved information keeps being reread without a new result. Choose Keep repairing to try another approach, or add a missing detail or source I should use."
          : stalled.channel === "reviews"
            ? "The same saved backend keeps failing the same checks without a code change. Choose Keep repairing to try another approach, or explain the expected result for the main action."
            : "The same operations keep returning unchanged information. Choose Keep repairing to try another approach, or add a missing detail or source I should use.",
      choices: ["Keep repairing", "I'll add more information"],
      answer: null,
    };
  }

  clear(taskId, channel) {
    this.sql.exec(
      "DELETE FROM task_progress WHERE task_id=? AND channel=?",
      taskId,
      channel,
    );
  }

  prune() {
    this.sql.exec(
      "DELETE FROM task_progress WHERE task_id IN (SELECT id FROM tasks WHERE record IS NULL)",
    );
  }
}
