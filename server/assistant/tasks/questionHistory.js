/** Immutable answered questions. The task repository owns the enclosing transaction. */
export class TaskQuestionHistory {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS task_question_history (
      task_id TEXT NOT NULL, sequence INTEGER NOT NULL, question_id TEXT NOT NULL,
      answer_id TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY(task_id,question_id), UNIQUE(task_id,answer_id), UNIQUE(task_id,sequence))`);
  }

  get(taskId, questionId) {
    const row = this.sql
      .exec(
        "SELECT body FROM task_question_history WHERE task_id=? AND question_id=?",
        taskId,
        questionId,
      )
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }

  answer(taskId, answerId) {
    const row = this.sql
      .exec(
        "SELECT body FROM task_question_history WHERE task_id=? AND answer_id=?",
        taskId,
        answerId,
      )
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }

  findAnswered(task, prompt) {
    const normalized = prompt.trim().toLowerCase();
    const recent = task.questions.find(
      (question) =>
        question.answer && question.prompt.trim().toLowerCase() === normalized,
    );
    if (recent) return recent;
    const row = this.sql
      .exec(
        "SELECT body FROM task_question_history WHERE task_id=? AND lower(trim(json_extract(body,'$.prompt')))=? LIMIT 1",
        task.id,
        normalized,
      )
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }

  archive(before, next) {
    const current = new Set(next.questions.map((item) => item.id));
    const removed = before.questions.filter((item) => !current.has(item.id));
    if (
      next.archivedQuestions !== before.archivedQuestions + removed.length ||
      removed.some((item) => !item.answer)
    )
      throw new Error(
        "Question checkpoint lost an answer or removed a pending question.",
      );
    for (const question of next.questions) {
      if (
        this.get(next.id, question.id) ||
        (question.answer &&
          (this.answer(next.id, question.answer.operationId) ||
            removed.some(
              (item) => item.answer.operationId === question.answer.operationId,
            )))
      )
        throw new Error(
          "An archived question or answer identity cannot be reused.",
        );
    }
    for (const operation of next.operations)
      if (
        this.answer(next.id, operation.id) ||
        removed.some((item) => item.answer.operationId === operation.id)
      )
        throw new Error("An archived answer identity cannot become an effect.");
    for (const [index, question] of removed.entries())
      this.sql.exec(
        "INSERT INTO task_question_history(task_id,sequence,question_id,answer_id,body) VALUES(?,?,?,?,?)",
        next.id,
        before.archivedQuestions + index + 1,
        question.id,
        question.answer.operationId,
        JSON.stringify(question),
      );
  }

  remove(taskId) {
    this.sql.exec("DELETE FROM task_question_history WHERE task_id=?", taskId);
  }
}
