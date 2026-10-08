import { contentDigest } from "../../contentDigest.js";
import {
  parseBuilderResearchResult,
  createCapabilityDecision,
} from "../../../packages/pvo-assistant/builder/index.js";

const requireEvidence = (condition, message) => {
  if (!condition) throw new Error(message);
};
const answeredCount = (task) =>
  task.archivedQuestions +
  task.questions.filter((question) => question.answer).length;

function receipt(coordinator, task, operationId, kind) {
  const row = coordinator.research.get(task.id, operationId);
  requireEvidence(
    row?.settled &&
      row.tool.kind === kind &&
      row.result?.status === "completed",
    "Use completed research from this task.",
  );
  return parseBuilderResearchResult(row.tool, row.result).result;
}

function question(coordinator, task, id) {
  if (id === null) return null;
  const value =
    task.questions.find((question) => question.id === id) ??
    coordinator.repository.questions.get(task.id, id);
  requireEvidence(
    value?.answer,
    "Choose an answered question belonging to this task.",
  );
  return value;
}

function latestDecisionRows(coordinator, taskId, key = null) {
  const sql = coordinator.research.sql;
  const filter =
    "task_id=? AND json_extract(body,'$.tool.kind')='capability_record' AND json_extract(body,'$.result.status')='completed'";
  const rows =
    key === null
      ? sql.exec(
          `SELECT body FROM task_research WHERE rowid IN (SELECT MAX(rowid) FROM task_research WHERE ${filter} GROUP BY json_extract(body,'$.tool.key')) ORDER BY rowid DESC LIMIT 21`,
          taskId,
        )
      : sql.exec(
          `SELECT body FROM task_research WHERE ${filter} AND json_extract(body,'$.tool.key')=? ORDER BY rowid DESC LIMIT 1`,
          taskId,
          key,
        );
  return rows.toArray().map((row) => JSON.parse(row.body));
}

function sourceFacts(coordinator, task, evidence, latest) {
  const source = coordinator.research.get(task.id, evidence.source.operationId);
  let page = receipt(
    coordinator,
    task,
    evidence.source.operationId,
    "web_read",
  );
  if (latest) {
    const row = coordinator.research.sql
      .exec(
        "SELECT body FROM task_research WHERE task_id=? AND json_extract(body,'$.tool.kind')='web_read' AND json_extract(body,'$.tool.url')=? AND json_extract(body,'$.result.status')='completed' ORDER BY rowid DESC LIMIT 1",
        task.id,
        source.tool.url,
      )
      .toArray()[0];
    if (row) page = JSON.parse(row.body).result.result;
  }
  return { url: page.url, text: page.text, truncated: page.truncated };
}

function relatedEvidence(coordinator, task, operation) {
  return coordinator.research.sql
    .exec(
      "SELECT body FROM task_research WHERE rowid IN (SELECT MAX(rowid) FROM task_research WHERE task_id=? AND json_extract(body,'$.tool.kind')='web_evidence' AND json_extract(body,'$.tool.operation')=? AND json_extract(body,'$.result.status')='completed' GROUP BY json_extract(body,'$.result.result.source.url')) ORDER BY rowid DESC LIMIT 32",
      task.id,
      operation,
    )
    .toArray()
    .map((row) => JSON.parse(row.body).result.result);
}

async function basisDigest(coordinator, task, tool, latest) {
  const sources = tool.basis.evidenceIds.map((id) =>
    sourceFacts(
      coordinator,
      task,
      receipt(coordinator, task, id, "web_evidence"),
      latest,
    ),
  );
  // New documentation for this operation must invalidate an earlier choice even at another URL.
  // Use a bounded recent-source window; receipts/history remain complete and paged.
  const relatedSources = relatedEvidence(coordinator, task, tool.operation).map(
    (note) => sourceFacts(coordinator, task, note, latest),
  );
  const uniqueSources = [
    ...new Map(
      [...sources, ...relatedSources].map((source) => [
        JSON.stringify(source),
        source,
      ]),
    ).values(),
  ];
  uniqueSources.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  return contentDigest(
    JSON.stringify({
      request: task.creationDigest,
      catalogVersion:
        tool.basis.type === "external"
          ? coordinator.connections.version()
          : null,
      answerCount: answeredCount(task),
      basis: {
        type: tool.basis.type,
        permissions: [...tool.basis.permissions].sort(),
        adapterOperation: tool.basis.adapterOperation,
      },
      connection:
        tool.basis.connectionId === null
          ? null
          : coordinator.connections.get(tool.basis.connectionId),
      sources: uniqueSources,
    }),
  );
}

/** Derive planning readiness from actual receipts/account metadata. No credentials or provider invocation. */
export async function recordCapability(coordinator, claimed, tool) {
  const task = coordinator.builders.task(claimed.id);
  const selectedAnswer = question(coordinator, task, tool.answerQuestionId);
  const basis = tool.basis;
  let connection = null;
  if (basis.type === "external") {
    requireEvidence(
      basis.connectionReadId !== null,
      "Inspect available connections before deciding external access.",
    );
    const page = receipt(
      coordinator,
      task,
      basis.connectionReadId,
      "connections_read",
    );
    requireEvidence(
      page.version === coordinator.connections.version(),
      "Inspect available accounts again after account setup changes.",
    );
    if (basis.connectionId !== null) {
      const observed = page.connections.find(
        (item) => item.id === basis.connectionId,
      );
      connection = coordinator.connections.get(basis.connectionId);
      requireEvidence(
        observed &&
          connection &&
          JSON.stringify(observed) === JSON.stringify(connection),
        "Inspect the current connection and permissions again.",
      );
    }
  }
  return createCapabilityDecision(tool, {
    connection,
    evidence: [
      ...basis.evidenceIds.map((id) =>
        receipt(coordinator, task, id, "web_evidence"),
      ),
      ...relatedEvidence(coordinator, task, tool.operation),
    ],
    selectedAnswer,
    basisDigest: await basisDigest(coordinator, task, tool, false),
    currentBasisDigest: await basisDigest(coordinator, task, tool, true),
    previous:
      latestDecisionRows(coordinator, task.id, tool.key)[0]?.result.result ??
      null,
    answerCount: answeredCount(task),
  });
}

/** Bounded current choices; complete receipts remain in the existing paged research history. */
export async function capabilityContext(coordinator, task) {
  const rows = latestDecisionRows(coordinator, task.id);
  const decisions = [];
  for (const row of rows.slice(0, 20)) {
    const value = parseBuilderResearchResult(row.tool, row.result).result;
    decisions.push({
      operationId: row.operationId,
      ...value,
      current:
        value.basisDigest ===
        (await basisDigest(coordinator, task, row.tool, true)),
    });
  }
  return { decisions, moreInResearchHistory: rows.length > 20 };
}
