import assert from "node:assert/strict";
import test from "node:test";
import { fixture, connectInput, setup, TOKEN } from "./helpers.mjs";
import { expectStatus, path } from "../assistant-task-server/helpers.mjs";
import { current } from "../assistant-task-server/workspace.helpers.mjs";

test("private setup resumes the same saved build, retains answers and connection reference across restart", async () => {
  const plans = [];
  const f = await fixture({
    workspaces: true,
    planner: async (request) => {
      const task = await request.json();
      plans.push(task);
      if (task.stepId === "plan")
        return Response.json({ kind: "checkpoint", stepId: "build" });
      if (!task.questions.length)
        return Response.json({
          kind: "ask",
          prompt: "Which issue state should the view show?",
          choices: ["Open issues", "All issues"],
        });
      if (task.questions.length === 1)
        return Response.json({
          kind: "connect_account",
          setup,
          purpose: "Read the issues for your chosen view.",
        });
      return Response.json({
        kind: "ask",
        prompt:
          "The account is connected. Continue once generated-service connection access is available?",
        choices: ["Keep saved"],
      });
    },
  });
  try {
    const project = (await f.project()).body.project;
    const created = await f.create(project.id);
    expectStatus(created, 201);
    const initial = created.body.task;
    async function drive() {
      for (let i = 0; i < 20; i++) {
        const task = await current(f, initial);
        if (["waiting_for_answer", "failed"].includes(task.state)) return task;
        expectStatus(await f.control({ action: "sweep" }), 200);
      }
      throw new Error("Saved setup did not reach a question");
    }
    let task = await drive();
    assert.equal(task.state, "waiting_for_answer");
    expectStatus(
      await f.request(`${path(task)}/answers`, {
        body: {
          expectedRevision: task.revision,
          questionId: task.questions[0].id,
          questionRevision: 0,
          operationId: "answer-intent",
          value: "Open issues",
        },
      }),
      200,
    );
    task = await drive();
    assert.equal(task.questions.length, 2);
    assert.deepEqual(task.questions[1].connection, setup);
    const answersBefore = task.questions[0];
    const usageBefore = task.usage;
    const operationsBefore = task.operations;
    expectStatus(
      await f.request(`${path(task)}/answers`, {
        body: {
          expectedRevision: task.revision,
          questionId: task.questions[1].id,
          questionRevision: 0,
          operationId: "forged-setup",
          value: "Connected to GitHub",
        },
      }),
      409,
    );
    expectStatus(await f.connection("connect", connectInput()), 200);
    const link = {
      id: "connection-one",
      taskId: task.id,
      questionId: task.questions[1].id,
      expectedRevision: task.revision,
      operationId: "connected-answer",
    };
    expectStatus(
      await f.connection("attach", link, { session: f.otherCookie }),
      404,
    );
    const attached = await f.connection("attach", link);
    expectStatus(attached, 200);
    assert.equal(attached.body.task.id, initial.id);
    assert.equal(attached.body.task.stepId, "build");
    assert.equal(attached.body.task.state, "queued");
    assert.deepEqual(attached.body.task.questions[0], answersBefore);
    assert.equal(
      attached.body.task.questions[1].answer.connectionId,
      "connection-one",
    );
    assert.deepEqual(attached.body.task.usage, usageBefore);
    assert.deepEqual(attached.body.task.operations, operationsBefore);
    expectStatus(await f.connection("attach", link), 200);
    await f.restart();
    task = await drive();
    assert.equal(task.questions.length, 3);
    assert.equal(task.questions[1].answer.connectionId, "connection-one");
    assert.deepEqual(task.questions[0], answersBefore);
    assert.equal(plans.filter((item) => item.stepId === "plan").length, 1);
    assert.equal(JSON.stringify(plans).includes(TOKEN), false);
    assert.equal(JSON.stringify(task).includes(TOKEN), false);
    const last = plans.at(-1);
    assert.equal(last.questions[1].answer.connectionId, "connection-one");
  } finally {
    await f.close();
  }
});
