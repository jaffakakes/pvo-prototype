import {
  newServiceTestReport,
  appendServiceCaseResult,
  parseServiceTestReport,
  SERVICE_TEST_LIMITS,
} from "../../../packages/pvo-assistant/services/index.js";

/** Immutable packages and platform reports live in the owner's coordinator, outside generated code. */
export class ServiceArtifacts {
  constructor(sql, tasks) {
    this.sql = sql;
    this.tasks = tasks;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS task_service_artifacts (task_id TEXT NOT NULL, round INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(task_id,round))",
    );
  }
  get(taskId, round) {
    const row = this.sql
      .exec(
        "SELECT body FROM task_service_artifacts WHERE task_id=? AND round=?",
        taskId,
        round,
      )
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  count(taskId) {
    return this.sql
      .exec(
        "SELECT COUNT(*) AS count FROM task_service_artifacts WHERE task_id=?",
        taskId,
      )
      .one().count;
  }
  save(taskId, round, artifact) {
    const prior = this.get(taskId, round);
    if (prior) {
      if (JSON.stringify(prior.artifact) !== JSON.stringify(artifact))
        throw new Error("Saved service package cannot be replaced.");
      return prior;
    }
    if (this.count(taskId) >= SERVICE_TEST_LIMITS.packages)
      throw Object.assign(new Error("Service package limit reached."), {
        code: "budget_exceeded",
      });
    const value = {
      taskId,
      round,
      artifact,
      report: newServiceTestReport(artifact.agreement, artifact.identity),
    };
    this.sql.exec(
      "INSERT INTO task_service_artifacts (task_id,round,body) VALUES (?,?,?)",
      taskId,
      round,
      JSON.stringify(value),
    );
    return value;
  }
  append(taskId, round, result) {
    const value = this.get(taskId, round);
    if (!value) throw new Error("Saved service package is missing.");
    value.report = appendServiceCaseResult(
      value.report,
      value.artifact.agreement,
      value.artifact.identity,
      result,
    );
    this.sql.exec(
      "UPDATE task_service_artifacts SET body=? WHERE task_id=? AND round=?",
      JSON.stringify(value),
      taskId,
      round,
    );
    return value;
  }
  verified(taskId, round) {
    const value = this.get(taskId, round);
    if (!value) return null;
    const report = parseServiceTestReport(
      value.report,
      value.artifact.agreement,
      value.artifact.identity,
    );
    return report.status === "passed" ? value : null;
  }
  prune(now) {
    const tasks = new Map(this.tasks.records().map((task) => [task.id, task]));
    for (const { task_id: id } of this.sql
      .exec("SELECT DISTINCT task_id FROM task_service_artifacts")
      .toArray())
      if (
        !tasks.has(id) ||
        (tasks.get(id).expiresAt !== null && tasks.get(id).expiresAt <= now)
      )
        this.sql.exec("DELETE FROM task_service_artifacts WHERE task_id=?", id);
  }
}
