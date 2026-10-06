import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, saved, path, NOW, expectStatus } from "./helpers.mjs";
import { current } from "./provider.helpers.mjs";
import {
  dinnerAgreement,
  dinnerSource,
  packageFor,
} from "../service-validation/fixtures.mjs";

const progress = async (f, task) =>
  (await f.control({ action: "progress-context", id: task.id })).body;
const validation = async (f, task) =>
  (await f.control({ action: "validation-state", id: task.id })).body;
const batch = (calls) => ({ kind: "tools", calls, review: null });
const plan = (task) =>
  task.stepId === "plan"
    ? { kind: "checkpoint", stepId: "build" }
    : !task.builderContext.agreement
      ? { kind: "agreement", agreement: dinnerAgreement() }
      : null;
async function sweepUntil(f, task, predicate) {
  for (let index = 0; index < 35; index++) {
    expectStatus(await f.control({ action: "sweep" }), 200);
    const value = await current(f, task);
    if (await predicate(value)) return value;
    if (value.state === "waiting" && value.nextRunAt !== null)
      await f.control({ action: "time", now: value.nextRunAt });
  }
  assert.fail("The controlled goal did not reach the expected checkpoint.");
}
async function answer(f, waiting, id) {
  const question = waiting.questions.at(-1);
  expectStatus(
    await f.request(path(waiting) + "/answers", {
      body: {
        expectedRevision: waiting.revision,
        questionId: question.id,
        questionRevision: 0,
        operationId: id,
        value: "Keep repairing",
      },
    }),
    200,
  );
}

test("unchanged research asks for help across restart, new answers continue the same goal, and private progress expires", async () => {
  let reads = 0,
    clarified = false;
  const calls = [];
  const f = await taskFixture({
    clock: NOW,
    workspaces: true,
    researchFetch: async (request) =>
      new URL(request.url).hostname === "dns.google"
        ? Response.json({ Status: 0, Answer: [{ type: 1, data: "8.8.8.8" }] })
        : (reads++,
          new Response(
            "<title>Booking</title><main>Call the restaurant to reserve.</main>",
            { headers: { "Content-Type": "text/html" } },
          )),
    planner: async (request) => {
      const task = await request.json();
      calls.push(task);
      return Response.json(
        task.stepId === "plan"
          ? { kind: "checkpoint", stepId: "build" }
          : clarified
            ? { kind: "ask", prompt: "Which date should I use?", choices: [] }
            : {
                kind: "research",
                calls: [
                  { kind: "web_read", url: "https://public.com/booking" },
                ],
              },
      );
    },
  });
  try {
    await f.control({ action: "time", now: NOW });
    const task = await saved(f);
    await sweepUntil(f, task, async () =>
      (await progress(f, task)).some((item) => item.repetitions === 2),
    );
    await f.restart();
    const waiting = await sweepUntil(
      f,
      task,
      (value) => value.state === "waiting_for_answer",
    );
    assert.match(waiting.questions[0].id, /^progress-help-/);
    assert.equal(reads, 3);
    assert.equal(waiting.usage.modelTurns, 4);
    assert.equal(waiting.usage.toolCalls, 3);
    assert.equal(waiting.usage.reservedToolCalls, 0);
    expectStatus(
      await f.request("/__test", {
        session: f.otherCookie,
        body: { action: "progress-context", id: task.id },
      }),
      409,
    );
    clarified = true;
    await answer(f, waiting, "answer-research-loop");
    const continued = await sweepUntil(
      f,
      task,
      (value) => value.state === "waiting_for_answer",
    );
    assert.equal(continued.questions.at(-1).prompt, "Which date should I use?");
    assert.equal(calls.at(-1).questions[0].answer.value, "Keep repairing");
    assert.equal(continued.usage.modelTurns, 5);
    expectStatus(
      await f.request(path(task) + "/stop", {
        body: { expectedRevision: continued.revision },
      }),
      200,
    );
    await f.control({ action: "time", now: NOW + 7 * 86400000 + 1 });
    await f.control({ action: "sweep" });
    assert.equal((await f.control({ action: "progress-count" })).body, 0);
  } finally {
    await f.close();
  }
});

test("unchanged saved source is detected despite new revisions; changed source continues beyond eight rounds", async () => {
  for (const changes of [false, true]) {
    let writes = 0;
    const f = await taskFixture({
      clock: NOW,
      workspaces: true,
      planner: async (request) => {
        const task = await request.json();
        const initial = plan(task);
        if (initial) return Response.json(initial);
        if (writes === 10)
          return Response.json({
            kind: "ask",
            prompt: "Which date should I use?",
            choices: [],
          });
        const content = `export function execute(){return ${changes ? writes : 0};}`;
        const decision = batch([
          {
            kind: "workspace_write",
            expectedRevision: writes++,
            files: packageFor(content).files,
          },
        ]);
        return Response.json(decision);
      },
    });
    try {
      await f.control({ action: "time", now: NOW });
      const task = await saved(f);
      const waiting = await sweepUntil(
        f,
        task,
        (value) => value.state === "waiting_for_answer",
      );
      assert.equal(writes, changes ? 10 : 3);
      assert.equal(waiting.usage.toolCalls, writes);
      assert.equal(waiting.usage.modelTurns, changes ? 13 : 5);
      if (changes)
        assert.equal(waiting.questions[0].prompt, "Which date should I use?");
      else assert.match(waiting.questions[0].id, /^progress-help-/);
      const row = (await progress(f, task))[0];
      assert.equal(row.repetitions, changes ? 1 : 3);
    } finally {
      await f.close();
    }
  }
});

test("rechecking the same failing backend asks for help, then changed source can pass the real checker", async () => {
  let repair = false;
  const f = await taskFixture({
    clock: NOW,
    workspaces: true,
    services: true,
    planner: async (request) => {
      const task = await request.json();
      const initial = plan(task);
      if (initial) return Response.json(initial);
      const writes = task.builderContext.feedback.filter(
        (item) => item.kind === "workspace_write",
      );
      if (!writes.length || (repair && writes.length === 1))
        return Response.json(
          batch([
            {
              kind: "workspace_write",
              expectedRevision: writes.length,
              files: packageFor(
                repair
                  ? dinnerSource
                  : "export function execute({state}){return {result:'wrong',state};}",
              ).files,
            },
          ]),
        );
      return Response.json({
        kind: "review",
        ...writes.at(-1).result.result,
        entrypoint: "src/service.mjs",
        tests: ["tests/service.test.mjs"],
      });
    },
  });
  try {
    await f.control({ action: "time", now: NOW });
    const task = await saved(f);
    await sweepUntil(
      f,
      task,
      async () =>
        (await validation(f, task)).artifacts.filter(
          (item) => item.report.status === "failed",
        ).length === 2,
    );
    await f.restart();
    const waiting = await sweepUntil(
      f,
      task,
      (value) => value.state === "waiting_for_answer",
    );
    assert.match(waiting.questions[0].prompt, /same saved backend/);
    const failed = (await validation(f, task)).artifacts;
    assert.equal(failed.length, 3);
    assert.ok(failed.every((item) => item.report.status === "failed"));
    assert.equal(
      new Set(failed.map((item) => item.artifact.identity.sourceDigest)).size,
      1,
    );
    assert.equal(waiting.result, null);
    assert.equal(waiting.usage.reservedToolCalls, 0);
    repair = true;
    await answer(f, waiting, "answer-review-loop");
    await sweepUntil(
      f,
      task,
      async () =>
        (await validation(f, task)).artifacts.at(-1)?.report.status ===
        "passed",
    );
    const repaired = (await validation(f, task)).artifacts;
    assert.equal(repaired.length, 4);
    assert.notEqual(
      repaired.at(-1).artifact.identity.sourceDigest,
      failed[0].artifact.identity.sourceDigest,
    );
    assert.equal(
      repaired.at(-1).artifact.identity.agreementDigest,
      failed[0].artifact.identity.agreementDigest,
    );
  } finally {
    await f.close();
  }
});

test("changing working notes cannot turn the same history fragment into new evidence", async () => {
  let calls = 0;
  const f = await taskFixture({
    clock: NOW,
    planner: async () =>
      Response.json({
        kind: "history",
        collection: "input",
        after: 0,
        offset: 0,
        notes: `Working note ${++calls}`,
      }),
  });
  try {
    await f.control({ action: "time", now: NOW });
    const task = await saved(f);
    const waiting = await sweepUntil(
      f,
      task,
      (value) => value.state === "waiting_for_answer",
    );
    assert.equal(calls, 3);
    assert.equal(waiting.usage.modelTurns, 3);
    assert.match(waiting.questions[0].prompt, /same saved information/);
    await f.restart();
    assert.deepEqual(await current(f, task), waiting);
    await f.control({ action: "sweep" });
    assert.equal(calls, 3);
  } finally {
    await f.close();
  }
});

test("progress storage failure preserves the actual receipt and resumes without repeating the tool", async () => {
  const f = await taskFixture({
    clock: NOW,
    workspaces: true,
    planner: async (request) => {
      const task = await request.json();
      return Response.json(plan(task) ?? batch([{ kind: "workspace_list" }]));
    },
  });
  try {
    await f.control({ action: "time", now: NOW });
    const task = await saved(f);
    await f.control({ action: "progress-write-failure", enabled: true });
    const failed = await sweepUntil(
      f,
      task,
      (value) => value.state === "failed",
    );
    assert.equal(failed.failure.code, "execution_failed");
    assert.equal(failed.usage.toolCalls, 1);
    assert.equal(
      (await f.control({ action: "builder-state", id: task.id })).body.feedback
        .length,
      0,
    );
    await f.control({ action: "progress-write-failure", enabled: false });
    await f.restart();
    expectStatus(
      await f.request(path(task) + "/resume", {
        body: { expectedRevision: failed.revision },
      }),
      200,
    );
    const waiting = await sweepUntil(
      f,
      task,
      (value) => value.state === "waiting_for_answer",
    );
    assert.equal(
      waiting.usage.toolCalls,
      3,
      "Recovery consumes the saved receipt, then runs only two new reads",
    );
    assert.equal((await progress(f, task))[0].repetitions, 3);
  } finally {
    await f.close();
  }
});
