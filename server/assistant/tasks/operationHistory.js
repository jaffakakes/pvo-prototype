/** Immutable settled receipts outside the current notebook; caller owns the transaction. */
export class TaskOperationHistory {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS task_operation_history (
      task_id TEXT NOT NULL, sequence INTEGER NOT NULL, operation_id TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY(task_id, operation_id), UNIQUE(task_id, sequence))`);
  }

  get(taskId, operationId) {
    const row = this.sql
      .exec(
        "SELECT body FROM task_operation_history WHERE task_id=? AND operation_id=?",
        taskId,
        operationId,
      )
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }

  page(taskId, after, limit = 8) {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 8
    )
      throw new Error("Invalid history page.");
    const rows = this.sql
      .exec(
        "SELECT sequence, body FROM task_operation_history WHERE task_id=? AND sequence>? ORDER BY sequence LIMIT ?",
        taskId,
        after,
        limit + 1,
      )
      .toArray();
    return {
      entries: rows.slice(0, limit).map((row) => ({
        sequence: row.sequence,
        operation: JSON.parse(row.body),
      })),
      next: rows.length > limit ? rows[limit - 1].sequence : null,
    };
  }

  archive(before, next) {
    const current = new Map(next.operations.map((item) => [item.id, item]));
    const removed = before.operations.filter((item) => !current.has(item.id));
    if (next.archivedOperations !== before.archivedOperations + removed.length)
      throw new Error("Operation checkpoint lost its source receipts.");
    for (const operation of removed) {
      if (["planned", "unknown"].includes(operation.status))
        throw new Error(
          "Uncertain operations cannot leave the current notebook.",
        );
    }
    for (const operation of next.operations) {
      const archived = this.get(next.id, operation.id);
      if (archived) {
        throw new Error("An archived operation cannot become a new attempt.");
      }
    }
    for (const question of next.questions)
      if (
        question.answer &&
        (this.get(next.id, question.answer.operationId) ||
          removed.some((item) => item.id === question.answer.operationId))
      )
        throw new Error("An archived effect identity cannot become an answer.");
    for (const [index, operation] of removed.entries())
      this.sql.exec(
        "INSERT INTO task_operation_history(task_id,sequence,operation_id,body) VALUES(?,?,?,?)",
        next.id,
        before.archivedOperations + index + 1,
        operation.id,
        JSON.stringify(operation),
      );
  }

  remove(taskId) {
    this.sql.exec("DELETE FROM task_operation_history WHERE task_id=?", taskId);
  }
}
