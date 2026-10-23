import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, expectStatus, path, NOW } from "./helpers.mjs";
import { current, guard, deferred, rows } from "./workspace.helpers.mjs";
import { evidencePage } from "../assistant-builder/research-evidence.fixture.mjs";

async function fixture({ hold = false } = {}) {
  const started = deferred(),
    release = deferred();
  let reads = 0,
    resumed = null;
  const f = await taskFixture({
    clock: NOW,
    workspaces: true,
    researchFetch: async (request) => {
      if (new URL(request.url).hostname === "dns.google")
        return Response.json({
          Status: 0,
          Answer: [{ type: 1, data: "8.8.8.8" }],
        });
      reads++;
      started.resolve();
      if (hold) await release.promise;
      return new Response(evidencePage.text, {
        headers: { "content-type": "text/plain" },
      });
    },
    planner: async (request) => {
      const task = await request.json();
      if (task.stepId === "plan")
        return Response.json({ kind: "checkpoint", stepId: "build" });
      if (!task.questions.length)
        return Response.json({
          kind: "ask_research",
          prompt: "Which calendar should supply your available times?",
          choices: ["Work calendar", "Personal calendar"],
          calls: [
            { kind: "web_read", url: evidencePage.url },
            { kind: "connections_read", after: null },
          ],
        });
      resumed = task;
      return Response.json({
        kind: "ask",
        prompt:
          "That calendar is not connected yet. Prepare a manual availability request instead?",
        choices: ["Prepare a request", "Wait for account setup"],
      });
    },
  });
  const project = await f.project();
  const response = await f.create(project.body.project.id, {
    request: "Show my free calendar times",
    examples: [],
  });
  expectStatus(response, 201);
  const task = response.body.task;
  const drive = async () => {
    for (let index = 0; index < 15; index++) {
      const currentTask = await current(f, task);
      if (
        ["waiting_for_answer", "stopped", "failed"].includes(currentTask.state)
      )
        return currentTask;
      expectStatus(await f.control({ action: "sweep" }), 200);
    }
    throw new Error("The saved research did not reach its expected wait.");
  };
  const answer = async () => {
    const latest = await current(f, task),
      question = latest.questions.find((question) => !question.answer);
    return f.request(`${path(task)}/answers`, {
      body: {
        expectedRevision: latest.revision,
        questionId: question.id,
        questionRevision: question.revision,
        operationId: "answer-calendar",
        value: "Work calendar",
      },
    });
  };
  return {
    f,
    task,
    drive,
    answer,
    started,
    release,
    reads: () => reads,
    resumed: () => resumed,
  };
}

test(
  "creator answers during actual saved research; the batch continues and dependent work uses the answer",
  { timeout: 20000 },
  async () => {
    const x = await fixture({ hold: true });
    let work;
    try {
      work = x.drive();
      await x.started.promise;
      const running = await current(x.f, x.task);
      assert.equal(running.state, "running");
      assert.equal(running.questions[0].answer, null);
      expectStatus(
        await x.f.control({
          action: "workspace-tool",
          id: x.task.id,
          operationId: "not-independent",
          tool: { kind: "workspace_list" },
          guard: guard(running),
        }),
        409,
      );
      expectStatus(
        await x.f.control({
          action: "research-tool",
          id: x.task.id,
          operationId: "unplanned-read",
          tool: { kind: "connections_read", after: null },
          guard: guard(await current(x.f, x.task)),
        }),
        409,
      );
      const answered = await x.answer();
      expectStatus(answered, 200);
      const saved = await current(x.f, x.task);
      assert.equal(saved.questions[0].answer.value, "Work calendar");
      assert.deepEqual(saved.claim, running.claim);
      x.release.resolve();
      const waiting = await work;
      assert.equal(waiting.state, "waiting_for_answer");
      assert.equal(x.resumed().questions[0].answer.value, "Work calendar");
      assert.equal(waiting.questions.length, 2);
      assert.equal(waiting.usage.toolCalls, 2);
      assert.equal(x.reads(), 1);
      assert.equal((await rows(x.f)).links.length, 0);
    } finally {
      x.release.resolve();
      await work?.catch(() => {});
      await x.f.close();
    }
  },
);

test(
  "late answers survive restart without repeating completed research",
  { timeout: 20000 },
  async () => {
    const x = await fixture();
    try {
      const waiting = await x.drive();
      assert.equal(waiting.state, "waiting_for_answer");
      assert.equal(waiting.usage.toolCalls, 2);
      assert.equal(x.resumed(), null);
      await x.f.restart();
      assert.deepEqual(
        (await current(x.f, x.task)).questions,
        waiting.questions,
      );
      expectStatus(await x.answer(), 200);
      await x.drive();
      assert.equal(x.reads(), 1);
      assert.equal(x.resumed().questions[0].answer.value, "Work calendar");
    } finally {
      await x.f.close();
    }
  },
);

test(
  "Stop while research awaits a response retains the question and fences the batch",
  { timeout: 20000 },
  async () => {
    const x = await fixture({ hold: true });
    let work;
    try {
      work = x.drive();
      await x.started.promise;
      const task = await current(x.f, x.task);
      expectStatus(
        await x.f.request(`${path(task)}/stop`, {
          body: { expectedRevision: task.revision },
        }),
        200,
      );
      x.release.resolve();
      await work;
      const stopped = await current(x.f, x.task);
      assert.equal(stopped.state, "stopped");
      assert.equal(stopped.questions[0].answer, null);
      assert.equal(x.resumed(), null);
      assert.equal(stopped.usage.reservedToolCalls, 0);
      assert.equal((await rows(x.f)).links.length, 0);
    } finally {
      x.release.resolve();
      await work?.catch(() => {});
      await x.f.close();
    }
  },
);
