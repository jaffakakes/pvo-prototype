import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, expectStatus, NOW, path } from "./helpers.mjs";
import { current, rows } from "./workspace.helpers.mjs";
import { connection } from "./capability-research.helpers.mjs";

// These are provider/planner fixtures, not templates shipped to creators or claims of model quality.
const cases = [
  {
    key: "calendar",
    request: "Show my free time without private event details",
    operation: "Read calendar free/busy intervals",
    status: "available",
    text: "GET /availability requires calendar.read and returns busy intervals without titles.",
    question: "Which calendars may viewers see?",
    connectionId: "work-calendar",
    adapterOperation: "availability",
    permissions: ["calendar.read"],
  },
  {
    key: "equipment",
    request: "Let colleagues request equipment in our work tracker",
    operation: "Create an equipment request",
    status: "needs_adapter",
    text: "POST /requests creates a request with equipment and project IDs. Requires requests.write permission.",
    question: "Which work project should receive equipment requests?",
    connectionId: "tracker",
    adapterOperation: null,
    permissions: ["requests.write"],
  },
  {
    key: "personal",
    request: "Use my personal calendar's free times",
    operation: "Read personal calendar availability",
    status: "needs_account",
    text: "GET /availability requires calendar.read permission on the selected calendar account.",
    question: "Wait for secure account setup or prepare a manual request?",
    connectionId: null,
    adapterOperation: null,
    permissions: ["calendar.read"],
  },
  {
    key: "restaurant",
    request: "Arrange a restaurant visit for friends",
    operation: "Reserve a restaurant table",
    status: "manual",
    text: "Reservations must be made by calling our staff. Our public site does not provide a booking API.",
    question: "Collect guest preferences for you to book by telephone?",
    connectionId: null,
    adapterOperation: null,
    permissions: [],
  },
  {
    key: "river",
    request: "Show water-level readings from an unfamiliar river gauge",
    operation: "Read current river water level",
    status: "unverified",
    text: "This gauge publishes readings on the website. Automated access and licensing are not described.",
    question:
      "Wait for access documentation or show instructions for checking the gauge?",
    connectionId: null,
    adapterOperation: null,
    permissions: [],
  },
  {
    key: "volunteers",
    request: "Save volunteer preferences in my own project",
    operation: "Save volunteer preferences",
    status: "available",
    text: null,
    question: "Who may submit preferences?",
    connectionId: null,
    adapterOperation: null,
    permissions: [],
  },
];

test(
  "saved research follows unrelated requests, including an unfamiliar goal and one needing no outside account",
  { timeout: 20000 },
  async () => {
    const contexts = new Map(),
      reads = [];
    const fixture = await taskFixture({
      clock: NOW,
      workspaces: true,
      researchFetch: async (request) => {
        if (new URL(request.url).hostname === "dns.google")
          return Response.json({
            Status: 0,
            Answer: [{ type: 1, data: "8.8.8.8" }],
          });
        const sample = cases.find((sample) =>
          request.url.endsWith(`/${sample.key}`),
        );
        reads.push(sample.key);
        return new Response(sample.text, {
          headers: { "content-type": "text/plain" },
        });
      },
      planner: async (request) => {
        const task = await request.json(),
          sample = cases.find(
            (sample) => sample.request === task.input.request,
          );
        assert.ok(sample);
        if (task.stepId === "plan")
          return Response.json({ kind: "checkpoint", stepId: "build" });
        const feedback = task.builderContext.feedback;
        const find = (kind) => feedback.find((item) => item.kind === kind);
        const research = (calls) => Response.json({ kind: "research", calls });
        if (sample.text && !find("web_read"))
          return research([
            { kind: "web_read", url: `https://docs.example.com/${sample.key}` },
            { kind: "connections_read", after: null },
          ]);
        if (sample.text && !find("web_evidence"))
          return research([
            {
              kind: "web_evidence",
              sourceOperationId: find("web_read").operationId,
              operation: sample.operation,
              support:
                sample.status === "unverified" ? "unclear" : "documented",
              excerpts: [sample.text],
              accessRequirements: sample.permissions,
              uncertainty: [
                "Provider behavior still needs independent testing",
              ],
              stillNeedsTesting: [
                `Check the requested result: ${sample.request}`,
              ],
            },
          ]);
        if (!find("capability_record"))
          return research([
            {
              kind: "capability_record",
              key: sample.key,
              operation: sample.operation,
              outcome: sample.request,
              status: sample.status,
              selection: sample.status === "manual" ? "proposed" : "selected",
              reason:
                sample.text ??
                "Restyle owns these records; no outside service is needed",
              answerQuestionId: null,
              basis: {
                type: sample.text ? "external" : "container_state",
                evidenceIds: sample.text
                  ? [find("web_evidence").operationId]
                  : [],
                connectionReadId: sample.text
                  ? find("connections_read").operationId
                  : null,
                connectionId: sample.connectionId,
                adapterOperation: sample.adapterOperation,
                permissions: sample.permissions,
              },
            },
          ]);
        contexts.set(sample.key, task.evidenceContext.capabilities);
        return Response.json({
          kind: "ask",
          prompt: sample.question,
          choices: [],
        });
      },
    });
    try {
      expectStatus(
        await fixture.control({
          action: "save-connection",
          expectedRevision: 0,
          connection: connection(),
        }),
        200,
      );
      expectStatus(
        await fixture.control({
          action: "save-connection",
          expectedRevision: 0,
          connection: connection({
            id: "tracker",
            name: "Work tracker",
            provider: "Tracker fixture",
            permissions: ["requests.write"],
            operations: [],
          }),
        }),
        200,
      );
      const project = await fixture.project();
      for (const [index, sample] of cases.entries()) {
        expectStatus(
          await fixture.control({
            action: "time",
            now: NOW + index * 86400000,
          }),
          200,
        );
        const created = await fixture.create(project.body.project.id, {
          operationId: `create-${sample.key}`,
          request: sample.request,
          examples: [],
        });
        expectStatus(created, 201);
        let task = created.body.task;
        for (
          let attempt = 0;
          attempt < 15 && task.state !== "waiting_for_answer";
          attempt++
        ) {
          expectStatus(await fixture.control({ action: "sweep" }), 200);
          task = await current(fixture, task);
        }
        assert.equal(
          task.state,
          "waiting_for_answer",
          JSON.stringify({
            key: sample.key,
            task,
            builder: (
              await fixture.control({ action: "builder-state", id: task.id })
            ).body,
          }),
        );
        assert.equal(task.questions[0].prompt, sample.question);
        const saved = contexts.get(sample.key).decisions[0];
        assert.equal(saved.current, true);
        assert.equal(saved.decision.operation, sample.operation);
        assert.equal(saved.decision.status, sample.status);
        assert.equal(saved.decision.outcome, sample.request);
        assert.equal(
          saved.decision.selection,
          sample.status === "manual" ? "proposed" : "selected",
        );
        assert.equal(saved.verification, "planning_only");
        expectStatus(
          await fixture.request(`${path(task)}/stop`, {
            body: { expectedRevision: task.revision },
          }),
          200,
        );
      }
      assert.deepEqual(
        [...reads].sort(),
        cases
          .filter((sample) => sample.text)
          .map((sample) => sample.key)
          .sort(),
      );
      assert.equal((await rows(fixture)).links.length, 0);
    } finally {
      await fixture.close();
    }
  },
);
