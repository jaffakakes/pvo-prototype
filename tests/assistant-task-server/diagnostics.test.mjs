import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, saved, path, NOW, expectStatus } from "./helpers.mjs";

test("private authoring diagnostics explain a rejected plan without restarting or changing its task", async () => {
  const fixture = await taskFixture({
    clock: NOW,
    planner: async () =>
      Response.json({ kind: "ask", question: { prompt: "Incomplete plan" } }),
  });
  try {
    const task = await saved(fixture);
    const route = path(task) + "/diagnostics";
    const initial = await fixture.request(route);
    expectStatus(initial, 200);
    assert.deepEqual(initial.body, { stepId: "plan", repair: null });
    await fixture.control({ action: "sweep" });
    await fixture.control({ action: "sweep" });
    const before = (await fixture.request(path(task))).body.task;
    assert.equal(before.state, "waiting_for_answer");
    const diagnostic = await fixture.request(route);
    expectStatus(diagnostic, 200);
    assert.equal(diagnostic.headers.get("cache-control"), "no-store");
    assert.equal(diagnostic.body.stepId, "plan");
    assert.equal(diagnostic.body.repair.check, "planning_response");
    assert.equal(diagnostic.body.repair.repetitions, 3);
    assert.match(diagnostic.body.repair.proposal.text, /Incomplete plan/);
    assert.deepEqual((await fixture.request(path(task))).body.task, before);
    await fixture.restart();
    assert.deepEqual((await fixture.request(route)).body, diagnostic.body);
    expectStatus(
      await fixture.request(route, { session: fixture.otherCookie }),
      404,
    );
    expectStatus(await fixture.request(route, { session: null }), 401);
    expectStatus(await fixture.request(route + "?owner=other"), 400);
    expectStatus(await fixture.request(route, { body: {} }), 404);
    assert.deepEqual((await fixture.request(path(task))).body.task, before);
  } finally {
    await fixture.close();
  }
});
