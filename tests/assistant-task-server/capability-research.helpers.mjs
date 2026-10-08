import { taskFixture, expectStatus } from "./helpers.mjs";
import { building, current, guard } from "./workspace.helpers.mjs";
import {
  evidencePage,
  evidenceNote,
} from "../assistant-builder/research-evidence.fixture.mjs";

export const connection = (overrides = {}) => ({
  id: "work-calendar",
  name: "Work calendar",
  provider: "Calendar fixture",
  status: "connected",
  revision: 1,
  permissions: ["calendar.read"],
  operations: [{ id: "availability", permissions: ["calendar.read"] }],
  ...overrides,
});
export const decision = (overrides = {}) => ({
  kind: "capability_record",
  key: "view-availability",
  operation: evidenceNote().operation,
  outcome: "Show free time intervals without event details.",
  selection: "selected",
  status: "available",
  reason: "Documented read with the connected account's installed adapter.",
  basis: {
    type: "external",
    evidenceIds: ["evidence"],
    connectionReadId: "connections",
    connectionId: "work-calendar",
    adapterOperation: "availability",
    permissions: ["calendar.read"],
  },
  answerQuestionId: null,
  ...overrides,
});

export async function capabilityFixture(options = {}) {
  let page = evidencePage.text,
    reads = 0;
  const fixture = await taskFixture({
    researchFetch: async (request) => {
      if (new URL(request.url).hostname === "dns.google")
        return Response.json({
          Status: 0,
          Answer: [{ type: 1, data: "8.8.8.8" }],
        });
      reads++;
      return new Response(
        `<title>Integration docs</title><main>${page}</main>`,
        { headers: { "content-type": "text/html" } },
      );
    },
    ...options,
  });
  const execute = async (task, tool, operationId) => {
    const response = await fixture.control({
      action: "research-tool",
      id: task.id,
      operationId,
      tool,
      guard: guard(await current(fixture, task)),
    });
    expectStatus(response, 200);
    return response.body;
  };
  const save = async (value = connection(), owner) => {
    const response = await fixture.control(
      {
        action: "save-connection",
        connection: value,
        expectedRevision: value.revision - 1,
      },
      owner,
    );
    expectStatus(response, 200);
    return response.body;
  };
  const start = async (
    id = "create-capability",
    request = "Show my free calendar times to visitors",
  ) => {
    const task = await building({
      ...fixture,
      create: (projectId) =>
        fixture.create(projectId, { operationId: id, request, examples: [] }),
    });
    await execute(
      task,
      { kind: "web_read", url: evidencePage.url },
      "read-availability",
    );
    await execute(task, evidenceNote(), "evidence");
    await execute(
      task,
      { kind: "connections_read", after: null },
      "connections",
    );
    return task;
  };
  return {
    fixture,
    start,
    execute,
    save,
    setPage: (value) => {
      page = value;
    },
    reads: () => reads,
  };
}
