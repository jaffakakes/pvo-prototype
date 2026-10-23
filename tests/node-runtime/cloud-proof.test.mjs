import test from "node:test";
import assert from "node:assert/strict";
import { cloudProofResources } from "../../scripts/checks/node-runtime/fly/cloud-resources.mjs";
import { runtimeConfiguration } from "../../scripts/checks/node-runtime/fly/image.mjs";

const id = "a".repeat(24);
const controller = {
  id: "11111111111111",
  name: `restyle-${id}-00`,
  state: "started",
  config: { metadata: { restyle_proof: id } },
};
const image = `registry.fly.io/restyle-node-proof-${id}@sha256:${"b".repeat(64)}`;
function fixture({ loseCreate = false } = {}) {
  const report = {
    id,
    app: `restyle-node-proof-${id}`,
    controllerId: controller.id,
    deadlineAt: Date.now() + 540000,
    machines: [],
  };
  const active = [controller];
  const calls = [];
  const saved = [];
  const request = async (method, path, body) => {
    calls.push({ method, path });
    if (method === "GET" && path.endsWith("/machines"))
      return { ok: true, status: 200, data: active };
    if (method === "POST") {
      assert.equal(report.machines.length, 1);
      assert.equal(report.machines[0].id, null);
      assert.ok(saved.length > 0);
      const actual = {
        id: "22222222222222",
        name: body.name,
        config: body.config,
        state: "started",
      };
      active.push(actual);
      if (loseCreate) throw new TypeError("lost create response");
      return { ok: true, status: 200, data: actual };
    }
    const target = path.split("/").at(-1).split("?")[0];
    const index = active.findIndex((item) => item.id === target);
    if (index < 0) return { ok: false, status: 404, data: null };
    if (method === "DELETE") {
      active.splice(index, 1);
      return { ok: true, status: 200, data: {} };
    }
    return { ok: true, status: 200, data: active[index] };
  };
  const resources = cloudProofResources(request, report, async () =>
    saved.push(structuredClone(report)),
  );
  return { resources, report, active, calls };
}
test("cloud controller journals one runtime and cleans it without removing itself or the app", async () => {
  const { resources, report, active, calls } = fixture();
  const machine = await resources.createMachine([], (options) =>
    runtimeConfiguration(image, options),
  );
  await assert.rejects(
    resources.createMachine([], (options) =>
      runtimeConfiguration(image, options),
    ),
    /Previous test cleanup/,
  );
  await assert.rejects(
    resources.removeMachine(controller),
    /cannot remove itself/,
  );
  await resources.removeMachine(machine);
  await resources.cleanup();
  assert.equal(report.runtimeCleanupVerified, true);
  assert.deepEqual(active, [controller]);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 1);
});
test("cloud proof discovers an uncertain create and preserves foreign Machines", async () => {
  const { resources, active, report, calls } = fixture({ loseCreate: true });
  await assert.rejects(
    resources.createMachine([], (options) =>
      runtimeConfiguration(image, options),
    ),
    /lost create/,
  );
  await resources.cleanup();
  assert.equal(report.runtimeCleanupVerified, true);
  assert.deepEqual(active, [controller]);
  active.push({
    ...controller,
    id: "33333333333333",
    config: { metadata: { restyle_proof: "foreign" } },
  });
  const count = calls.filter((call) => call.method === "DELETE").length;
  await assert.rejects(resources.cleanup(), /Unexpected Machine/);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, count);
});

test("cloud observation recovers a lost start reply without starting another controller", async () => {
  const { observeCloudController } =
    await import("../../scripts/checks/node-runtime/fly/cloud-observer.mjs");
  const { NODE_RUNTIME } =
    await import("../../server/cloud-services/node/runtime.js");
  const report = {
    id: "a".repeat(24),
    app: "restyle-node-proof-" + "a".repeat(24),
    sourceDigest: "b".repeat(64),
    machines: [],
  };
  let starts = 0;
  const resources = {
    report,
    save: async () => {},
    request: async (method, path) => {
      if (path.endsWith("/start")) {
        starts++;
        throw Object.assign(new Error("start reply lost"), {
          name: "TimeoutError",
        });
      }
      return {
        ok: true,
        status: 200,
        data: {
          state: starts ? "started" : "stopped",
          image_ref: { digest: NODE_RUNTIME.baseImage.split("@")[1] },
        },
      };
    },
  };
  const machine = {
    path: "/apps/owned/machines/1234567890abcd",
    record: { id: "1234567890abcd" },
    command: async () =>
      JSON.stringify({
        ...report,
        phase: "passed",
        checks: [],
        controllerId: "1234567890abcd",
        runtimeCasesPassed: true,
        runtimeCleanupVerified: true,
        build: { sourceDigest: report.sourceDigest },
      }),
  };
  await observeCloudController(machine, resources);
  assert.equal(starts, 1);
  assert.equal(report.controllerStartUncertain, true);
  assert.equal(report.runtimeCasesPassed, true);
});
