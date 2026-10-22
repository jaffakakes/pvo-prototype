import { DatabaseSync } from "node:sqlite";
import {
  recordCapability,
  capabilityContext,
} from "../../../server/assistant/builder/capabilityResearch.js";
import { contentDigest } from "../../../server/contentDigest.js";
import {
  parseBuilderResearchResult,
  researchFailure,
} from "../../../packages/pvo-assistant/builder/index.js";

/** Empty-account/offline fixture. Capability decisions use the actual task adapter and SQL rules. */
export async function missingAccountResearch(input, initialFeedback) {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE task_research(task_id TEXT, body TEXT)");
  const task = {
    ...input,
    id: "missing-account-probe",
    creationDigest: await contentDigest(JSON.stringify(input.input)),
    archivedQuestions: 0,
  };
  const receipts = new Map();
  const save = (operationId, tool, result) => {
    const receipt = { operationId, tool, result, settled: true };
    receipts.set(operationId, receipt);
    database
      .prepare("INSERT INTO task_research VALUES (?, ?)")
      .run(task.id, JSON.stringify(receipt));
  };
  const coordinator = {
    builders: { task: () => task },
    connections: { version: () => 0, get: () => null },
    repository: {
      questions: {
        get: (_, id) => task.questions.find((question) => question.id === id),
      },
    },
    research: {
      get: (_, operationId) => receipts.get(operationId),
      sql: {
        exec: (query, ...bindings) => ({
          toArray: () => database.prepare(query).all(...bindings),
        }),
      },
    },
  };
  try {
    for (const row of initialFeedback) {
      const tool = { kind: "connections_read", after: null };
      const result = parseBuilderResearchResult(tool, row.result);
      if (
        row.kind !== tool.kind ||
        result.status !== "completed" ||
        result.result.connections.length ||
        result.result.next !== null ||
        result.result.version !== 0
      )
        throw new Error(
          "Missing-account evaluation requires its frozen empty catalogue.",
        );
      save(row.operationId, tool, result);
    }
  } catch (error) {
    database.close();
    throw error;
  }
  return {
    async execute(call, operationId) {
      let result;
      if (call.kind === "connections_read") {
        result = {
          kind: call.kind,
          status: "completed",
          result: { connections: [], next: null, version: 0 },
        };
      } else if (["web_read", "web_search"].includes(call.kind)) {
        result = { kind: call.kind, status: "unavailable", result: null };
      } else if (call.kind === "web_evidence") {
        // This fixture has no successful page reads; source IDs never grant fabricated evidence.
        result = researchFailure(
          call.kind,
          new Error("Use a completed web_read operation from this task."),
        );
      } else if (call.kind === "capability_record") {
        try {
          result = {
            kind: call.kind,
            status: "completed",
            result: await recordCapability(coordinator, task, call),
          };
        } catch (error) {
          result = researchFailure(call.kind, error);
        }
      } else {
        throw new Error(
          "Unimplemented missing-account evaluation research tool: " +
            call.kind,
        );
      }
      result = parseBuilderResearchResult(call, result);
      save(operationId, call, result);
      return result;
    },
    capabilities: () => capabilityContext(coordinator, task),
    close: () => database.close(),
  };
}
