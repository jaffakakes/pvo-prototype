import {
  newServiceTestReport,
  appendServiceCaseResult,
  parseServiceTestReport,
  parseServiceState,
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
  save(taskId, round, artifact) {
    const prior = this.get(taskId, round);
    if (prior) {
      if (JSON.stringify(prior.artifact) !== JSON.stringify(artifact))
        throw new Error("Saved service package cannot be replaced.");
      return prior;
    }
    const value = {
      taskId,
      round,
      artifact,
      report: newServiceTestReport(artifact.agreement, artifact.identity),
      cursor: {
        step: 0,
        state: structuredClone(artifact.agreement.cases[0].initialState),
      },
    };
    this.sql.exec(
      "INSERT INTO task_service_artifacts (task_id,round,body) VALUES (?,?,?)",
      taskId,
      round,
      JSON.stringify(value),
    );
    return value;
  }
  advance(taskId, round, observation) {
    const value = this.get(taskId, round);
    if (!value) throw new Error("Saved service package is missing.");
    if (
      value.report.status !== "running" ||
      observation.index !== value.report.cases.length ||
      observation.step !== value.cursor?.step
    )
      throw new Error(
        "Validation step no longer matches its saved checkpoint.",
      );
    const scenario = value.artifact.agreement.cases[observation.index];
    if (observation.caseResult) {
      if (
        observation.caseResult.status === "passed" &&
        observation.step + 1 !== scenario.steps.length
      )
        throw new Error("A case cannot pass before its last step.");
      if (
        observation.caseResult.status !== "passed" &&
        observation.caseResult.completedSteps !== observation.step
      )
        throw new Error("Wrong incomplete validation step.");
      value.report = appendServiceCaseResult(
        value.report,
        value.artifact.agreement,
        value.artifact.identity,
        observation.caseResult,
      );
      value.cursor =
        value.report.status === "running"
          ? {
              step: 0,
              state: structuredClone(
                value.artifact.agreement.cases[value.report.cases.length]
                  .initialState,
              ),
            }
          : null;
    } else {
      if (observation.step + 1 >= scenario.steps.length)
        throw new Error("Last validation step needs a completed case result.");
      value.cursor = {
        step: observation.step + 1,
        state: parseServiceState(value.artifact.agreement, observation.state),
      };
    }
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
