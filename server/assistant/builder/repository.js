import {
  newBuilderState,
  parseBuilderState,
  builderStage,
  acceptBuilderDecision,
  beginBuilderBatch,
  nextBuilderTool,
  recordBuilderTool,
  interruptBuilderBatch,
  builderContext,
  recordBuilderReview,
} from "../../../packages/pvo-assistant/builder/index.js";
import { hasCurrentClaim } from "../tasks/executionClaim.js";

/** Saved decisions and tool cursor. The task coordinator supplies the enclosing SQL transaction. */
export class TaskBuilders {
  constructor(sql, tasks) {
    this.sql = sql;
    this.tasks = tasks;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS task_builders (task_id TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
  }
  get(taskId) {
    const row = this.sql
      .exec("SELECT body FROM task_builders WHERE task_id=?", taskId)
      .toArray()[0];
    return row ? parseBuilderState(JSON.parse(row.body)) : newBuilderState();
  }
  write(taskId, state) {
    this.sql.exec(
      "INSERT INTO task_builders (task_id,body) VALUES (?,?) ON CONFLICT(task_id) DO UPDATE SET body=excluded.body",
      taskId,
      JSON.stringify(parseBuilderState(state)),
    );
  }
  task(id) {
    return this.tasks.records().find((task) => task.id === id);
  }
  current(claimed, now) {
    return hasCurrentClaim(this.task(claimed.id), claimed, now);
  }
  stage(id) {
    return builderStage(this.get(id));
  }
  context(id) {
    return builderContext(this.get(id));
  }

  prepare(claimed, decision, agreementDigest, now) {
    if (!this.current(claimed, now)) return null;
    if (claimed.stepId !== "build")
      throw new Error("Builder decisions require a build task.");
    const state = acceptBuilderDecision(
      this.get(claimed.id),
      decision,
      agreementDigest,
    );
    if (decision.kind === "ask")
      return {
        state,
        command: {
          kind: "ask",
          question: {
            id: `question-${this.task(claimed.id).archivedQuestions + this.task(claimed.id).questions.length + 1}`,
            revision: 0,
            prompt: decision.prompt,
            choices: decision.choices,
            answer: null,
          },
        },
      };
    return {
      state,
      command: {
        kind: "checkpoint",
        stepId: decision.kind === "review" ? "validate" : "build",
      },
    };
  }

  beginBatch(claimed, now) {
    if (!this.current(claimed, now)) return null;
    const state = this.get(claimed.id);
    if (
      state.claimGeneration !== null &&
      state.claimGeneration !== claimed.generation
    )
      return { interrupted: true, state };
    const next = beginBuilderBatch(state, claimed.generation);
    this.write(claimed.id, next);
    return { interrupted: false, state: next };
  }
  next(id) {
    return nextBuilderTool(this.get(id));
  }
  feedback(claimed, position, result, halt, now) {
    if (!this.current(claimed, now)) return false;
    const state = this.get(claimed.id);
    if (state.claimGeneration !== claimed.generation) return false;
    this.write(claimed.id, recordBuilderTool(state, position, result, halt));
    return true;
  }
  recoveredFeedback(claimed, position, result, halt, now) {
    if (!this.current(claimed, now)) return false;
    this.write(
      claimed.id,
      recordBuilderTool(this.get(claimed.id), position, result, halt),
    );
    return true;
  }
  interrupt(claimed, now) {
    if (!this.current(claimed, now)) return false;
    this.write(claimed.id, interruptBuilderBatch(this.get(claimed.id)));
    return true;
  }
  review(claimed, feedback, now) {
    if (!this.current(claimed, now) || claimed.stepId !== "validate")
      return false;
    this.write(claimed.id, recordBuilderReview(this.get(claimed.id), feedback));
    return true;
  }
  prune(now) {
    const tasks = new Map(this.tasks.records().map((task) => [task.id, task]));
    for (const { task_id: id } of this.sql
      .exec("SELECT task_id FROM task_builders")
      .toArray())
      if (
        !tasks.has(id) ||
        (tasks.get(id).expiresAt !== null && tasks.get(id).expiresAt <= now)
      )
        this.sql.exec("DELETE FROM task_builders WHERE task_id=?", id);
  }
}
