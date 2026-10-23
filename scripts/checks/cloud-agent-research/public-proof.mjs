import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import {
  taskFixture,
  expectStatus,
} from "../../../tests/assistant-task-server/helpers.mjs";
import {
  building,
  current,
  guard,
  rows,
} from "../../../tests/assistant-task-server/workspace.helpers.mjs";

// Real public HTTP + the actual task research journal. No model, cloud deployment or account API call.
const fixture = await taskFixture({
  researchFetch: (request) =>
    fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      redirect: "manual",
    }),
});
try {
  const task = await building({
    ...fixture,
    create: (projectId) =>
      fixture.create(projectId, {
        request: "Show private calendar availability without event details",
        examples: [],
      }),
  });
  const execute = async (tool, operationId) => {
    const response = await fixture.control({
      action: "research-tool",
      id: task.id,
      operationId,
      tool,
      guard: guard(await current(fixture, task)),
    });
    expectStatus(response, 200);
    assert.equal(response.body.status, "completed", operationId);
    return response.body.result;
  };
  const page = await execute(
    {
      kind: "web_read",
      url: "https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query",
    },
    "google-docs",
  );
  const operation = "Read private calendar free/busy intervals";
  const evidence = await execute(
    {
      kind: "web_evidence",
      sourceOperationId: "google-docs",
      operation,
      support: "documented",
      excerpts: ["Returns free/busy information for a set of calendars."],
      accessRequirements: [
        "Check granted Calendar scopes and permission to the requested private calendar",
      ],
      uncertainty: [
        "The documentation permits optional authorization in some cases; that does not establish access to this creator's private calendar. No provider account is connected.",
      ],
      stillNeedsTesting: [
        "Authenticate a test account and verify private calendar access, timezones and per-calendar errors",
      ],
    },
    "google-evidence",
  );
  const connections = await execute(
    { kind: "connections_read", after: null },
    "accounts",
  );
  assert.deepEqual(connections.connections, []);
  const selected = await execute(
    {
      kind: "capability_record",
      key: "private-calendar",
      operation,
      outcome: "Display busy intervals without exposing titles",
      selection: "selected",
      status: "needs_account",
      reason:
        "The API operation is documented, but this account has no connected Calendar permissions. Adapter code and independent provider tests remain necessary.",
      basis: {
        type: "external",
        evidenceIds: ["google-evidence"],
        connectionReadId: "accounts",
        connectionId: null,
        adapterOperation: null,
        permissions: ["https://www.googleapis.com/auth/calendar.freebusy"],
      },
      answerQuestionId: null,
    },
    "calendar-choice",
  );
  await fixture.restart();
  const context = await fixture.control({
    action: "capability-context",
    id: task.id,
  });
  expectStatus(context, 200);
  assert.equal(context.body.decisions[0].current, true);
  assert.equal(context.body.decisions[0].decision.status, "needs_account");
  assert.equal((await rows(fixture)).links.length, 0);
  const report = {
    source: evidence.source,
    assessment: evidence.assessment,
    decision: selected.decision,
    verification: selected.verification,
    retainedAfterRestart: true,
    connections: 0,
    workspaces: 0,
    providerActionTested: false,
    modelTested: false,
  };
  if (process.env.RESEARCH_REPORT)
    await writeFile(
      process.env.RESEARCH_REPORT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fixture.close();
}
