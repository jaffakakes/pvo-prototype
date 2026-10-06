import { parseEvidenceRequest } from "./evidenceInput.js";

const sources = {
  questions: {
    table: "task_question_history",
    sequence: "sequence",
    project: (value) => value,
  },
  operations: {
    table: "task_operation_history",
    sequence: "sequence",
    project: (value) => value,
  },
  research: {
    table: "task_research",
    sequence: "rowid",
    project: (value) => ({
      operationId: value.operationId,
      tool: value.tool,
      settled: value.settled,
      result: value.result,
    }),
  },
  workspace: {
    table: "workspace_operations",
    sequence: "rowid",
    project: (value) => ({
      operationId: value.operationId,
      kind: value.kind,
      settled: value.settled,
      receipt: value.receipt,
    }),
  },
  reviews: {
    table: "task_service_artifacts",
    sequence: "round",
    project: (value) => ({
      round: value.round,
      identity: value.artifact.identity,
      report: value.report,
    }),
  },
};

/** One bounded history selection for inference. All rows belong to the same authenticated coordinator. */
export class TaskEvidence {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS task_evidence (task_id TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
  }

  context(task) {
    const row = this.sql
      .exec("SELECT body FROM task_evidence WHERE task_id=?", task.id)
      .toArray()[0];
    return {
      archivedQuestions: task.archivedQuestions,
      archivedOperations: task.archivedOperations,
      selection: row ? JSON.parse(row.body) : null,
    };
  }

  select(task, request) {
    request = parseEvidenceRequest(request);
    const source = sources[request.collection];
    // Identifiers come only from the fixed map above; task/cursor values are bound.
    const row = this.sql
      .exec(
        `SELECT ${source.sequence} AS sequence,body FROM ${source.table} WHERE task_id=? AND ${source.sequence}>? ORDER BY ${source.sequence} LIMIT 1`,
        task.id,
        request.after,
      )
      .toArray()[0];
    const text = row
      ? JSON.stringify(source.project(JSON.parse(row.body)))
      : "";
    const points = [...text];
    if (request.offset > points.length)
      throw new Error("Evidence offset exceeds the saved entry.");
    let next = request.offset,
      content = "",
      bytes = 0;
    while (next < points.length) {
      const length = new TextEncoder().encode(points[next]).length;
      if (bytes + length > 4096) break;
      bytes += length;
      content += points[next++];
    }
    return {
      ...request,
      sequence: row?.sequence ?? null,
      content,
      nextOffset: next < points.length ? next : null,
    };
  }

  save(taskId, selection) {
    this.sql.exec(
      "INSERT INTO task_evidence(task_id,body) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET body=excluded.body",
      taskId,
      JSON.stringify(selection),
    );
  }

  prune() {
    this.sql.exec(
      "DELETE FROM task_evidence WHERE task_id IN (SELECT id FROM tasks WHERE record IS NULL)",
    );
  }
}
