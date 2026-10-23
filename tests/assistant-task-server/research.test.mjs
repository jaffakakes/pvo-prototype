import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { taskFixture, saved, path, expectStatus } from "./helpers.mjs";
import {
  building,
  guard,
  current,
  rows,
  deferred,
} from "./workspace.helpers.mjs";
const options = { timeout: 20000 };
const read = { kind: "web_read", url: "https://public.com/reservations" };
const research = (calls) => ({ kind: "research", calls });
const ask = () => ({
  kind: "ask",
  prompt:
    "The public page says telephone bookings only. Continue with planning?",
  choices: ["Continue"],
});
const taskState = async (fixture, task) =>
  (await fixture.control({ action: "builder-state", id: task.id })).body;
const researchRows = async (fixture) =>
  (await fixture.control({ action: "research-rows" })).body;
async function until(read, predicate) {
  const deadline = Date.now() + 12000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await delay(20);
  }
  assert.fail(
    "Research did not reach expected state: " + JSON.stringify(value),
  );
}
const dns = (request) => new URL(request.url).hostname === "dns.google";
const address = () =>
  Response.json({ Status: 0, Answer: [{ type: 1, data: "8.8.8.8" }] });
const page = () =>
  new Response(
    "<title>Restaurant</title><main>Telephone bookings only.</main>",
    { headers: { "Content-Type": "text/html" } },
  );
const plan = (task) =>
  task.stepId === "plan" ? { kind: "checkpoint", stepId: "build" } : null;

test(
  "public research saves cited evidence before agreement, meters once and survives restart without a VM",
  options,
  async () => {
    let reads = 0;
    const calls = [];
    const fixture = await taskFixture({
      workspaces: true,
      researchFetch: async (request) => {
        if (dns(request)) return address();
        reads++;
        assert.equal(request.headers.get("Authorization"), null);
        assert.equal(request.headers.get("Cookie"), null);
        return page();
      },
      planner: async (request) => {
        const task = await request.json();
        calls.push(task);
        return Response.json(
          plan(task) ??
            (!task.builderContext.feedback.length ? research([read]) : ask()),
        );
      },
    });
    try {
      const task = await saved(fixture);
      const waiting = await until(
        () => current(fixture, task),
        (value) => value.state === "waiting_for_answer",
      );
      assert.equal(waiting.usage.toolCalls, 1);
      assert.equal(waiting.usage.reservedToolCalls, 0);
      assert.equal(waiting.usage.modelTurns, 3);
      assert.equal(reads, 1);
      assert.ok(
        JSON.stringify(calls.at(-1).builderContext.feedback).includes(
          "Telephone bookings only.",
        ),
      );
      const before = await taskState(fixture, task);
      assert.equal(before.agreement, null);
      assert.equal(before.feedback[0].result.result.url, read.url);
      assert.equal((await rows(fixture)).links.length, 0);
      const receipts = await researchRows(fixture);
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0].settled, true);
      await fixture.restart();
      assert.deepEqual(await taskState(fixture, task), before);
      assert.deepEqual(await researchRows(fixture), receipts);
      assert.equal(reads, 1);
      const foreign = await fixture.request("/__test", {
        session: fixture.otherCookie,
        body: { action: "research-rows" },
      });
      assert.deepEqual(foreign.body, []);
      const stopped = await fixture.request(path(task) + "/stop", {
        body: { expectedRevision: waiting.revision },
      });
      expectStatus(stopped, 200);
      await fixture.control({
        action: "time",
        now: stopped.body.task.expiresAt + 1,
      });
      await fixture.control({ action: "sweep" });
      assert.deepEqual(await researchRows(fixture), []);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "public research continues past four calls and saves all evidence without a VM",
  options,
  async () => {
    let reads = 0;
    const fixture = await taskFixture({
      workspaces: true,
      researchFetch: async (request) => {
        if (dns(request)) return address();
        reads++;
        return page();
      },
      planner: async (request) => {
        const task = await request.json();
        return Response.json(
          plan(task) ??
            (reads < 8
              ? research([
                  read,
                  { ...read, url: `https://public.com/details-${reads}` },
                ])
              : ask()),
        );
      },
    });
    try {
      const task = await saved(fixture);
      const result = await until(
        () => current(fixture, task),
        (value) => value.state === "waiting_for_answer",
      );
      assert.equal(reads, 8);
      assert.equal(result.usage.toolCalls, 8);
      assert.equal(result.usage.reservedToolCalls, 0);
      assert.equal((await researchRows(fixture)).length, 8);
      const evidence = await fixture.control({
        action: "select-evidence",
        id: task.id,
        request: {
          kind: "history",
          collection: "research",
          after: 0,
          offset: 0,
          notes: "Read the original public page evidence.",
        },
      });
      expectStatus(evidence, 200);
      const entry = JSON.parse(evidence.body.content);
      assert.equal(entry.result.result.url, read.url);
      assert.ok(evidence.body.content.includes("Telephone bookings only."));
      assert.equal((await rows(fixture)).links.length, 0);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "restart during public research preserves an unknown receipt and never silently repeats the request",
  options,
  async () => {
    const entered = deferred();
    let reads = 0;
    const calls = [];
    const fixture = await taskFixture({
      workspaces: true,
      researchFetch: async (request) => {
        if (dns(request)) return address();
        reads++;
        entered.resolve();
        await delay(2200);
        return page();
      },
      planner: async (request) => {
        const task = await request.json();
        calls.push(task);
        return Response.json(
          plan(task) ??
            (!task.builderContext.feedback.length
              ? research([read, read])
              : ask()),
        );
      },
    });
    try {
      const task = await saved(fixture);
      await entered.promise;
      await fixture.restart();
      const waiting = await until(
        () => current(fixture, task),
        (value) => value.state === "waiting_for_answer",
      );
      assert.equal(reads, 1);
      assert.equal(waiting.retries, 1);
      assert.equal(waiting.usage.toolCalls, 1);
      assert.equal(waiting.usage.reservedToolCalls, 0);
      assert.equal(
        calls.at(-1).builderContext.feedback[0].result.status,
        "unknown",
      );
      assert.equal(calls.at(-1).builderContext.feedback[0].result.result, null);
      assert.equal((await rows(fixture)).links.length, 0);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "Stop cancels public research and discards its late evidence",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    let reads = 0;
    const fixture = await taskFixture({
      workspaces: true,
      researchFetch: async (request) => {
        if (dns(request)) return address();
        reads++;
        entered.resolve();
        await release.promise;
        return page();
      },
      planner: async (request) => {
        const task = await request.json();
        return Response.json(plan(task) ?? research([read, read]));
      },
    });
    try {
      const task = await saved(fixture);
      await entered.promise;
      const running = await current(fixture, task);
      expectStatus(
        await fixture.request(path(task) + "/stop", {
          body: { expectedRevision: running.revision },
        }),
        200,
      );
      release.resolve();
      const stopped = await until(
        () => current(fixture, task),
        (value) =>
          value.state === "stopped" && value.usage.reservedToolCalls === 0,
      );
      assert.equal(stopped.usage.toolCalls, 1);
      assert.equal(reads, 1);
      assert.equal((await taskState(fixture, task)).feedback.length, 0);
      assert.equal((await researchRows(fixture))[0].result.status, "unknown");
    } finally {
      release.resolve();
      await fixture.close();
    }
  },
);

test(
  "research replays its exact saved result once and rejects reused identities with different input",
  options,
  async () => {
    let reads = 0;
    const fixture = await taskFixture({
      researchFetch: async (request) => {
        if (dns(request)) return address();
        reads++;
        return page();
      },
    });
    try {
      const task = await building(fixture);
      const execute = async (tool) =>
        fixture.control({
          action: "research-tool",
          id: task.id,
          operationId: "research-once",
          tool,
          guard: guard(await current(fixture, task)),
        });
      const result = await execute(read);
      expectStatus(result, 200);
      assert.equal(result.body.status, "completed");
      assert.deepEqual((await execute(read)).body, result.body);
      await fixture.restart();
      assert.deepEqual((await execute(read)).body, result.body);
      expectStatus(
        await execute({ ...read, url: "https://public.com/changed" }),
        409,
      );
      assert.equal(reads, 1);
      assert.equal((await current(fixture, task)).usage.toolCalls, 1);
      assert.equal((await researchRows(fixture)).length, 1);
    } finally {
      await fixture.close();
    }
  },
);
