import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, expectStatus, path, NOW } from "./helpers.mjs";
import { building, current, guard, rows } from "./workspace.helpers.mjs";
import {
  evidencePage,
  evidenceNote,
} from "../assistant-builder/research-evidence.fixture.mjs";

async function researchTask(fixture, operationId) {
  return building({
    ...fixture,
    create: (projectId) =>
      fixture.create(projectId, {
        operationId,
        request: "Show free calendar times to visitors.",
        examples: [],
      }),
  });
}

async function setup() {
  let reads = 0;
  const fixture = await taskFixture({
    researchFetch: async (request) => {
      if (new URL(request.url).hostname === "dns.google")
        return Response.json({
          Status: 0,
          Answer: [{ type: 1, data: "8.8.8.8" }],
        });
      reads++;
      if (request.url.endsWith("/unavailable"))
        return new Response("Unavailable", { status: 503 });
      return new Response(
        `<title>${evidencePage.title}</title><main>${evidencePage.text}</main>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  const execute = async (task, tool, operationId) =>
    fixture.control({
      action: "research-tool",
      id: task.id,
      operationId,
      tool,
      guard: guard(await current(fixture, task)),
    });
  return { fixture, execute, reads: () => reads };
}

test(
  "evidence is task-owned, uses the saved read time, survives restart and replays without network or compute",
  { timeout: 20000 },
  async () => {
    const { fixture, execute, reads } = await setup();
    try {
      const task = await researchTask(fixture, "create-research");
      const read = await execute(
        task,
        { kind: "web_read", url: evidencePage.url },
        "read-availability",
      );
      expectStatus(read, 200);
      assert.equal(read.body.status, "completed");
      const note = await execute(task, evidenceNote(), "save-evidence");
      expectStatus(note, 200);
      assert.equal(note.body.status, "completed");
      assert.equal(
        note.body.result.source.checkedAt,
        read.body.result.retrievedAt,
      );
      assert.equal(note.body.result.source.url, read.body.result.url);
      assert.equal(note.body.result.verification, "source_text_only");
      assert.equal(reads(), 1);
      assert.equal((await current(fixture, task)).usage.toolCalls, 2);
      assert.equal((await rows(fixture)).links.length, 0);
      await fixture.restart();
      assert.deepEqual(
        (await execute(task, evidenceNote(), "save-evidence")).body,
        note.body,
      );
      assert.equal(reads(), 1);
      assert.equal((await current(fixture, task)).usage.toolCalls, 2);
      expectStatus(
        await execute(
          task,
          evidenceNote({ operation: "Changed goal" }),
          "save-evidence",
        ),
        409,
      );
      const history = await fixture.control({
        action: "select-evidence",
        id: task.id,
        request: {
          kind: "history",
          collection: "research",
          after: 1,
          offset: 0,
          notes: "Use the saved access requirements.",
        },
      });
      expectStatus(history, 200);
      assert.match(history.body.content, /source_text_only/);
      assert.match(history.body.content, /stillNeedsTesting/);
      const other = await fixture.request("/__test", {
        session: fixture.otherCookie,
        body: { action: "research-rows" },
      });
      assert.deepEqual(other.body, []);
      const stopped = await fixture.request(path(task) + "/stop", {
        body: { expectedRevision: (await current(fixture, task)).revision },
      });
      expectStatus(stopped, 200);
      await fixture.control({
        action: "time",
        now: stopped.body.task.expiresAt + 1,
      });
      await fixture.control({ action: "sweep" });
      assert.deepEqual(
        (await fixture.control({ action: "research-rows" })).body,
        [],
      );
    } finally {
      await fixture.close();
    }
  },
);

test(
  "evidence cannot cite a different task, failed source, prior note or invented excerpt",
  { timeout: 20000 },
  async () => {
    const { fixture, execute, reads } = await setup();
    try {
      const first = await researchTask(fixture, "create-first");
      await execute(
        first,
        { kind: "web_read", url: evidencePage.url },
        "read-availability",
      );
      const second = await researchTask(fixture, "create-second");
      const missing = await execute(
        second,
        evidenceNote(),
        "foreign-reference",
      );
      assert.deepEqual(missing.body, {
        kind: "web_evidence",
        status: "unavailable",
        result: null,
      });
      await execute(
        first,
        { kind: "web_read", url: "https://calendar.example.com/unavailable" },
        "failed-read",
      );
      await execute(first, evidenceNote(), "valid-note");
      for (const [index, change] of [
        { sourceOperationId: "failed-read" },
        { sourceOperationId: "valid-note" },
        { excerpts: ["The account is authorized and booking succeeded."] },
      ].entries()) {
        const result = await execute(
          first,
          evidenceNote(change),
          `rejected-${index}`,
        );
        expectStatus(result, 200);
        assert.deepEqual(result.body, {
          kind: "web_evidence",
          status: "unavailable",
          result: null,
        });
      }
      assert.equal(reads(), 2);
      assert.equal((await rows(fixture)).links.length, 0);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "the saved runner researches, records structured evidence, and presents a question without starting a workshop",
  { timeout: 20000 },
  async () => {
    let finalContext;
    const fixture = await taskFixture({
      clock: NOW,
      workspaces: true,
      researchFetch: async (request) =>
        new URL(request.url).hostname === "dns.google"
          ? Response.json({ Status: 0, Answer: [{ type: 1, data: "8.8.8.8" }] })
          : new Response(evidencePage.text, {
              headers: { "Content-Type": "text/plain" },
            }),
      planner: async (request) => {
        const task = await request.json();
        if (task.stepId === "plan")
          return Response.json({ kind: "checkpoint", stepId: "build" });
        const feedback = task.builderContext.feedback;
        const source = feedback.find(
          (entry) => entry.result.kind === "web_read",
        );
        const evidence = feedback.find(
          (entry) => entry.result.kind === "web_evidence",
        );
        if (!source)
          return Response.json({
            kind: "research",
            calls: [{ kind: "web_read", url: evidencePage.url }],
          });
        if (!evidence)
          return Response.json({
            kind: "research",
            calls: [evidenceNote({ sourceOperationId: source.operationId })],
          });
        finalContext = task.builderContext;
        return Response.json({
          kind: "ask",
          prompt: "Which calendar should supply your available times?",
          choices: [],
        });
      },
    });
    try {
      const project = await fixture.project();
      const created = await fixture.create(project.body.project.id, {
        request: "Show my free calendar times to visitors.",
        examples: [],
      });
      expectStatus(created, 201);
      let task = created.body.task;
      for (
        let index = 0;
        index < 15 && task.state !== "waiting_for_answer";
        index++
      ) {
        expectStatus(await fixture.control({ action: "sweep" }), 200);
        task = await current(fixture, task);
      }
      assert.equal(task.state, "waiting_for_answer");
      assert.equal(task.usage.toolCalls, 2);
      assert.equal(finalContext.agreement, null);
      const note = finalContext.feedback.find(
        (entry) => entry.result.kind === "web_evidence",
      ).result;
      assert.equal(note.status, "completed");
      assert.deepEqual(
        note.result.assessment.stillNeedsTesting,
        evidenceNote().stillNeedsTesting,
      );
      assert.equal((await rows(fixture)).links.length, 0);
      await fixture.restart();
      assert.deepEqual(
        (await fixture.control({ action: "builder-state", id: task.id })).body
          .feedback,
        finalContext.feedback,
      );
    } finally {
      await fixture.close();
    }
  },
);
