import assert from "node:assert/strict";
import test from "node:test";
import { createServiceSubmissionClient } from "../../packages/pvo-assistant/attachments/index.js";
import { dinnerAgreement } from "../service-packages/fixtures.mjs";
import { deferred } from "../assistant-task-server/provider.helpers.mjs";

const target = {
  origin: "https://services.example",
  serviceId: "service-" + "a".repeat(64),
  releaseId: "release-" + "b".repeat(64),
  operation: dinnerAgreement().operations[0],
  mode: "public",
  ownerId: null,
};
const active = () => ({ isCurrent: () => true });
const reply = (request, result = "accepted") => ({
  actionId: JSON.parse(request.body).actionId,
  result,
});

// An atomic in-memory adapter isolates orchestration rules. The separate browser adapter needs its own IndexedDB acceptance check.
function storage() {
  const entries = new Map();
  let tail = Promise.resolve();
  return {
    read: async (slot) => structuredClone(entries.get(slot) ?? null),
    update(slot, change) {
      const pending = tail.then(() => {
        const next = change(structuredClone(entries.get(slot) ?? null));
        entries.set(slot, structuredClone(next));
        return structuredClone(next);
      });
      tail = pending.catch(() => {});
      return pending;
    },
  };
}

test("failed persistence sends nothing; a lost response retries saved input after client recreation", async () => {
  const store = storage();
  let sends = 0,
    ids = 0,
    loseReply = true;
  const adapters = {
    store,
    createId: () => `action-${++ids}`,
    send: async (request) => {
      sends++;
      assert.equal(
        (await store.read("component")).action.actionId,
        JSON.parse(request.body).actionId,
      );
      if (loseReply) throw new Error("Lost reply after sending");
      return reply(request);
    },
  };
  const unavailable = createServiceSubmissionClient({
    ...adapters,
    store: {
      ...store,
      update: async () => {
        throw new Error("Disk unavailable");
      },
    },
  });
  await assert.rejects(
    unavailable.submit("component", target, { name: "Alice" }, active()),
    /Disk unavailable/,
  );
  assert.equal(sends, 0);
  const first = createServiceSubmissionClient(adapters);
  await assert.rejects(
    first.submit("component", target, { name: "Alice" }, active()),
    /Lost reply/,
  );
  const intent = await store.read("component");
  assert.equal(intent.response, null);
  const restored = createServiceSubmissionClient(adapters);
  await assert.rejects(
    restored.submit("component", target, { name: "Bob" }, active()),
    { code: "submission_pending" },
  );
  assert.equal(sends, 1);
  assert.deepEqual(await store.read("component"), intent);
  loseReply = false;
  const complete = await restored.retry("component", target, active());
  assert.equal(complete.action.actionId, intent.action.actionId);
  assert.deepEqual(complete.action.input, { name: "Alice" });
  assert.equal(ids, 1);
  await restored.retry("component", target, active());
  assert.equal(sends, 2, "A saved result does not need another request");
  const next = await restored.submit(
    "component",
    target,
    { name: "Alice" },
    active(),
  );
  assert.notEqual(next.action.actionId, complete.action.actionId);
});

test("concurrent changed-input submissions cannot replace the pending transaction", async () => {
  const store = storage(),
    gate = deferred();
  let ids = 0,
    sends = 0;
  const client = createServiceSubmissionClient({
    store,
    createId: () => `id-${++ids}`,
    send: async (request) => {
      sends++;
      await gate.promise;
      return reply(request);
    },
  });
  const first = client.submit("slot", target, { name: "Alice" }, active());
  const second = client.submit("slot", target, { name: "Bob" }, active());
  try {
    await assert.rejects(second, { code: "submission_pending" });
    assert.equal(ids, 1);
    assert.equal(sends, 1);
    assert.deepEqual((await store.read("slot")).action.input, {
      name: "Alice",
    });
  } finally {
    gate.resolve();
    await first;
  }
});

test("a late reply cannot overwrite a newer saved intent after another retry completed", async () => {
  const store = storage(),
    gate = deferred(),
    entered = deferred();
  let ids = 0,
    sends = 0;
  const client = createServiceSubmissionClient({
    store,
    createId: () => `id-${++ids}`,
    send: async (request) => {
      if (++sends === 1) {
        entered.resolve();
        await gate.promise;
      }
      return reply(request);
    },
  });
  const pending = client.submit("slot", target, { name: "Alice" }, active());
  const rejected = assert.rejects(pending, { code: "submission_changed" });
  await entered.promise;
  await client.retry("slot", target, active());
  const newer = await client.submit("slot", target, { name: "Bob" }, active());
  gate.resolve();
  await rejected;
  assert.deepEqual(await store.read("slot"), newer);
});

test("cancellation fences dispatch and UI completion while allowing an existing response to settle its own intent", async () => {
  const store = storage(),
    gate = deferred(),
    entered = deferred();
  let current = true,
    sends = 0;
  const context = { isCurrent: () => current };
  const client = createServiceSubmissionClient({
    store,
    createId: () => "id-one",
    send: async (request) => {
      sends++;
      entered.resolve();
      await gate.promise;
      return reply(request);
    },
  });
  current = false;
  await assert.rejects(
    client.submit("slot", target, { name: "Alice" }, context),
    { name: "AbortError" },
  );
  assert.equal(await store.read("slot"), null);
  assert.equal(sends, 0);
  current = true;
  const pending = client.submit("slot", target, { name: "Alice" }, context);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await entered.promise;
  current = false;
  gate.resolve();
  await rejected;
  assert.equal((await store.read("slot")).response.result, "accepted");
  await client.retry("slot", target, active());
  assert.equal(sends, 1);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    client.retry("slot", target, { ...active(), signal: aborted.signal }),
    { name: "AbortError" },
  );
});

test("invalid replies and failed completion writes retain retryable intent; changed scope and repeated new IDs are rejected", async () => {
  const store = storage();
  let wrongReply = true,
    failCompletion = false,
    sends = 0;
  const client = createServiceSubmissionClient({
    store: {
      ...store,
      update: (slot, change) =>
        store.update(slot, (previous) => {
          const next = change(previous);
          if (next.response && failCompletion)
            throw new Error("Completion write failed");
          return next;
        }),
    },
    createId: () => "same-id",
    send: async (request) => {
      sends++;
      return wrongReply
        ? { actionId: "other", result: "accepted" }
        : reply(request);
    },
  });
  await assert.rejects(
    client.submit("slot", target, { name: "Alice" }, active()),
    /another action/,
  );
  assert.equal((await store.read("slot")).response, null);
  wrongReply = false;
  failCompletion = true;
  await assert.rejects(
    client.retry("slot", target, active()),
    /Completion write failed/,
  );
  assert.equal((await store.read("slot")).response, null);
  await assert.rejects(
    client.retry(
      "slot",
      { ...target, origin: "https://other.example" },
      active(),
    ),
    /another connection/,
  );
  assert.equal(sends, 2);
  failCompletion = false;
  const complete = await client.retry("slot", target, active());
  await assert.rejects(
    client.submit("slot", target, { name: "Alice" }, active()),
    { code: "invalid_action_id" },
  );
  assert.deepEqual(await store.read("slot"), complete);
  assert.equal(sends, 3);
});

test("form and target changes while storage opens cannot rewrite the captured intent", async () => {
  const store = storage(),
    gate = deferred();
  const input = { name: "Alice" };
  const expected = structuredClone(target);
  const client = createServiceSubmissionClient({
    store: {
      ...store,
      update: async (slot, change) => {
        await gate.promise;
        return store.update(slot, change);
      },
    },
    createId: () => "captured",
    send: async (request) => {
      assert.deepEqual(JSON.parse(request.body).input, { name: "Alice" });
      assert.ok(request.url.startsWith(target.origin));
      return reply(request);
    },
  });
  const pending = client.submit("slot", expected, input, active());
  input.name = "Bob";
  expected.origin = "https://changed.example";
  gate.resolve();
  const completed = await pending;
  assert.equal(completed.target.origin, target.origin);
  assert.equal(completed.action.input.name, "Alice");
});
