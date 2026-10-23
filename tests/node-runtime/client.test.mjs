import test from "node:test";
import assert from "node:assert/strict";
import { executeNodeBundle } from "../../server/cloud-services/node/client.js";

const bundle = {
  entrypoint: "src/main.mjs",
  files: [
    { path: "src/main.mjs", content: "export function execute(){return null}" },
  ],
  dependencies: [],
};
const scope = { ownerId: "owner", serviceId: "service", mode: "test" };

test("private Node client tries only free fixed slots and preserves the exact owned invocation", async () => {
  const requests = [],
    names = [];
  const namespace = {
    getByName(name) {
      names.push(name);
      return {
        execute: async (input) => {
          requests.push(input);
          return requests.length === 1
            ? { ok: false, code: "execution_capacity" }
            : { ok: true, value: { result: "saved" } };
        },
        cancel: async () => {
          throw new Error("No cancellation of a confirmed result");
        },
      };
    },
  };
  assert.deepEqual(
    await executeNodeBundle(namespace, bundle, { state: {} }, scope),
    { result: "saved" },
  );
  assert.deepEqual([...names].sort(), ["slot-0", "slot-1"]);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].ownerId, "owner");
  assert.equal(requests[0].mode, "test");
  assert.deepEqual(requests[0].bundle, bundle);
});

test("aborted unknown dispatch is cancelled without starting a replacement; late reply is ignored", async () => {
  let enter, release;
  const entered = new Promise((r) => (enter = r)),
    held = new Promise((r) => (release = r)),
    controller = new AbortController();
  const requests = [],
    cancelled = [];
  const namespace = {
    getByName() {
      return {
        execute: async (input) => {
          requests.push(input);
          enter();
          await held;
          return { ok: true, value: "late" };
        },
        cancel: async (id) => {
          cancelled.push(id);
          return { closed: true };
        },
      };
    },
  };
  const result = executeNodeBundle(
    namespace,
    bundle,
    {},
    scope,
    controller.signal,
  );
  await entered;
  controller.abort();
  await assert.rejects(result);
  release();
  assert.equal(requests.length, 1);
  assert.deepEqual(cancelled, [requests[0].id]);
});

test("capacity remains a retryable infrastructure outcome, never a generated-code failure", async () => {
  let starts = 0,
    cancels = 0;
  const retryAt = Date.now() + 1000;
  const namespace = {
    getByName() {
      return {
        execute: async () => {
          starts++;
          return { ok: false, code: "execution_allowance", retryAt };
        },
        cancel: async () => {
          cancels++;
          return { closed: true };
        },
      };
    },
  };
  await assert.rejects(
    executeNodeBundle(namespace, bundle, {}, scope),
    (error) =>
      error.code === "execution_allowance" && error.retryAt === retryAt,
  );
  assert.equal(starts, 2);
  assert.equal(cancels, 2);
});
