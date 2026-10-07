import test from "node:test";
import assert from "node:assert/strict";
import { readNodeUsage } from "../../server/cloud-services/node/usage.js";
import { inspectServiceRecords } from "../../server/cloud-services/records.js";
import { NODE_COMPUTE_RATES } from "../../server/cloud-services/node/cost.js";
import {
  SERVICE_COMPUTE_MODES,
  SERVICE_COMPUTE_COUNTERS,
} from "../../packages/pvo-assistant/hosting/index.js";

const now = Date.UTC(2026, 9, 7, 12);
function snapshot() {
  const periods = Object.fromEntries(
    SERVICE_COMPUTE_MODES.map((mode) => [
      mode,
      Object.fromEntries(SERVICE_COMPUTE_COUNTERS.map((key) => [key, 0])),
    ]),
  );
  periods.live = {
    starts: 2,
    milliseconds: 3000,
    startupMilliseconds: 1000,
    executionMilliseconds: 1000,
    cleanupMilliseconds: 1000,
    admittedBytes: 1200,
    resultBytes: 20,
  };
  return {
    ownerId: "owner",
    serviceId: "service",
    observedAt: now,
    periodStartAt: now - 30 * 86400000,
    resetsAt: Date.UTC(2026, 9, 8),
    periods,
    capacity: {
      busy: false,
      ownerRemaining: 48,
      ownerLimit: 50,
      platformRemaining: 498,
      platformLimit: 500,
    },
    pending: null,
    instance: {
      provider: "fly",
      region: "iad",
      cpuKind: "shared",
      cpus: 1,
      memoryMiB: 1024,
    },
  };
}
function namespace(values) {
  let disposed = 0;
  return {
    get disposed() {
      return disposed;
    },
    getByName(name) {
      return {
        async usage(owner, service) {
          assert.equal(owner, "owner");
          assert.equal(service, "service");
          return {
            ...structuredClone(values[Number(name.slice(-1))]),
            [Symbol.dispose]() {
              disposed++;
            },
          };
        },
      };
    },
  };
}
test("private slot usage aggregates completed costs separately from pending cleanup and releases RPC replies", async () => {
  const a = snapshot(),
    b = snapshot();
  b.capacity.busy = true;
  b.pending = {
    mode: "validation",
    phase: "cleanup",
    startedAt: now - 5000,
    deadlineAt: now + 5000,
    milliseconds: 5000,
  };
  const ns = namespace([a, b]);
  const result = await readNodeUsage(ns, "owner", "service");
  assert.equal(result.state, "available");
  assert.equal(result.capacity.ownerRemaining, 96);
  assert.equal(result.capacity.platformRemaining, 996);
  assert.equal(result.capacity.busySlots, 1);
  assert.equal(result.periods.live.milliseconds, 6000);
  assert.equal(
    result.estimate.completedUsd,
    6 * NODE_COMPUTE_RATES.machineSecondUsd,
  );
  assert.equal(
    result.estimate.pendingUsd,
    5 * NODE_COMPUTE_RATES.machineSecondUsd,
  );
  assert.deepEqual(result.pending, [b.pending]);
  assert.equal(ns.disposed, 2);
  assert.equal(Object.hasOwn(result, "ownerId"), false);
});
test("unknown or malformed metering never reports unused capacity or zero costs", async () => {
  for (const mutate of [
    (s) => (s.ownerId = "another-owner"),
    (s) => (s.serviceId = "another-service"),
    (s) => (s.resetsAt += 86400000),
    (s) => (s.capacity.busy = "false"),
    (s) => (s.capacity.ownerRemaining = -1),
    (s) => (s.periods.live.starts = -1),
    (s) => (s.periods.live.executionMilliseconds = 4000),
    (s) => (s.instance.memoryMiB = 2048),
    (s) => delete s.pending,
    (s) =>
      (s.pending = {
        mode: "live",
        phase: "cleanup",
        startedAt: now,
        deadlineAt: now + 5000,
        milliseconds: 0,
      }),
  ]) {
    const changed = snapshot();
    mutate(changed);
    assert.deepEqual(
      await readNodeUsage(namespace([snapshot(), changed]), "owner", "service"),
      { state: "unavailable" },
    );
  }
  assert.deepEqual(await readNodeUsage(null, "owner", "service"), {
    state: "unavailable",
  });
  assert.deepEqual(
    await readNodeUsage(
      {
        getByName: () => ({
          usage: async () => {
            throw new Error("offline");
          },
        }),
      },
      "owner",
      "service",
    ),
    { state: "unavailable" },
  );
});
test("ownership and deletion are checked before private compute effects and rechecked after waiting", async () => {
  let calls = 0;
  let service = {
    identity: { ownerId: "owner", serviceId: "service" },
    state: "active",
  };
  const host = {
    store: { service: () => service },
    env: {
      SERVICE_NODE_EXECUTION: {
        getByName() {
          calls++;
          return {
            async usage() {
              service = { ...service, state: "deleted" };
              return snapshot();
            },
          };
        },
      },
    },
    ctx: { storage: { transactionSync: (fn) => fn() } },
  };
  await assert.rejects(() =>
    inspectServiceRecords(host, "service", "wrong-owner"),
  );
  assert.equal(calls, 0);
  service = { ...service, state: "deleted" };
  await assert.rejects(() => inspectServiceRecords(host, "service", "owner"));
  assert.equal(calls, 0);
  service = { ...service, state: "active" };
  await assert.rejects(
    () => inspectServiceRecords(host, "service", "owner"),
    /deleted/,
  );
  assert.equal(calls, 2);
});
