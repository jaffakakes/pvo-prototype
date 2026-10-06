import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptanceReady,
  acceptanceTransport,
} from "../../scripts/checks/cloud-agent-first-release/transport.mjs";
import { exerciseAuthoring } from "../../scripts/checks/cloud-agent-first-release/exercise.mjs";

test("startup retains a private diagnosis and survives a repair past the old thirty-second window", async () => {
  let now = 0;
  const records = [];
  const call = acceptanceTransport(
    async () =>
      now < 60000
        ? {
            status: 503,
            data: {
              startup: {
                phase: "budget",
                message: "Simulated unavailable binding",
              },
            },
          }
        : { status: 200, marker: "owned-proof", data: { ready: true } },
    {
      expiresAt: 90000,
      now: () => now,
      wait: async (ms) => {
        now += ms;
      },
      record: async (kind, detail) => records.push({ kind, ...detail }),
    },
  );
  await acceptanceReady(call, "owned-proof");
  assert.ok(now >= 60000 && now < 90000);
  assert.equal(records[0].startup.phase, "budget");
  assert.equal(records[0].startup.message, "Simulated unavailable binding");
  await assert.rejects(
    acceptanceReady(
      async () => ({ status: 200, marker: "other", data: { ready: true } }),
      "owned-proof",
    ),
    /did not become ready/,
  );
});

test("a lost answer reply and a transient status failure recover the same task without repeating its effect", async () => {
  let answered = false,
    lostReply = false,
    lostRead = false,
    effects = 0;
  const bodies = [],
    records = [],
    delivered = [];
  const snapshot = (subject) => ({
    task: {
      id: subject,
      revision: answered ? 2 : 1,
      state: subject === "dinner" && !answered ? "waiting_for_answer" : "ready",
      questions:
        subject === "dinner" && !answered
          ? [{ id: "seats", revision: 0, answer: null }]
          : [],
    },
    result: {},
    services: [{}],
    workspaces: [{ absent: true }],
  });
  const call = acceptanceTransport(
    async (path, method, body) => {
      const [, subject, operation] = path.split("/");
      if (operation === "command") {
        bodies.push(structuredClone(body));
        if (!answered) {
          answered = true;
          effects++;
        }
        if (!lostReply) {
          lostReply = true;
          return { status: 503, data: null };
        }
      }
      if (operation === "status" && answered && !lostRead) {
        lostRead = true;
        throw new TypeError("simulated lost connection");
      }
      return { status: 200, data: snapshot(subject) };
    },
    {
      expiresAt: Date.now() + 10000,
      wait: async () => {},
      record: async (kind, detail) => records.push({ kind, ...detail }),
    },
  );
  await exerciseAuthoring(call, async () => {}, {
    expiresAt: Date.now() + 10000,
    pollMs: 1,
    answerQuestion: async () => "Two seats",
    onReady: async (subject) => delivered.push(subject),
  });
  assert.equal(effects, 1);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1], bodies[0]);
  assert.equal(records.length, 2);
  assert.deepEqual(delivered, ["dinner", "equipment"]);
});

test("transport preserves exact API creation identity and does not replay restart, resume or unrecognized effects", async () => {
  for (const [path, body] of [
    ["/dinner/restart", undefined],
    [
      "/dinner/command",
      { kind: "resume", id: "task", input: { expectedRevision: 1 } },
    ],
    [
      "/dinner/api",
      { path: "/api/services/service-one/delete", method: "POST", body: {} },
    ],
  ]) {
    let calls = 0;
    const call = acceptanceTransport(
      async () => {
        calls++;
        return { status: 503 };
      },
      {
        expiresAt: Date.now() + 10000,
        wait: async () => {
          assert.fail("Unsafe operation retried");
        },
      },
    );
    assert.equal((await call(path, "POST", body)).status, 503);
    assert.equal(calls, 1);
  }
  const intent = {
    path: "/api/assistant/tasks",
    method: "POST",
    body: { operationId: "saved-creation", request: "Create RSVP" },
  };
  const received = [];
  const call = acceptanceTransport(
    async (_path, _method, body) => {
      received.push(structuredClone(body));
      body.body.request = "transport mutation";
      return { status: received.length === 1 ? 502 : 200 };
    },
    { expiresAt: Date.now() + 10000, wait: async () => {} },
  );
  assert.equal((await call("/dinner/api", "POST", intent)).status, 200);
  assert.deepEqual(received, [intent, intent]);
});

test("recovery respects permanent errors, cancellation and the original deadline", async () => {
  let now = 0,
    calls = 0;
  const call = acceptanceTransport(
    async () => {
      calls++;
      return { status: 503 };
    },
    {
      expiresAt: 3000,
      now: () => now,
      wait: async (ms) => {
        now += ms;
      },
    },
  );
  await assert.rejects(call("/dinner/status"), /deadline ended/);
  assert.equal(now, 3000);
  assert.equal(calls, 2);
  const denied = acceptanceTransport(async () => ({ status: 403 }), {
    expiresAt: Date.now() + 10000,
    wait: async () => assert.fail("Permanent rejection retried"),
  });
  assert.equal((await denied("/dinner/status")).status, 403);
  const controller = new AbortController();
  controller.abort();
  const cancelled = acceptanceTransport(
    async () => assert.fail("Cancelled request sent"),
    { expiresAt: Date.now() + 10000, signal: controller.signal },
  );
  await assert.rejects(cancelled("/dinner/status"), { name: "AbortError" });
});
