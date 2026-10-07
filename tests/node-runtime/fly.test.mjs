import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  flyApi,
  requireFly,
} from "../../scripts/checks/node-runtime/fly/api.mjs";
import { flyProofResources } from "../../scripts/checks/node-runtime/fly/resources.mjs";
import { FlyProofMachine } from "../../scripts/checks/node-runtime/fly/machine.mjs";
import { NODE_RUNTIME } from "../../server/cloud-services/node/runtime.js";

const ok = (data) => ({ ok: true, status: 200, data });
const absent = () => ({ ok: false, status: 404, data: null });
async function fixture(t, override = () => null) {
  const directoryRoot = await mkdtemp(join(tmpdir(), "restyle-fly-test-"));
  t.after(() => rm(directoryRoot, { recursive: true, force: true }));
  const state = {
    app: null,
    machines: [],
    calls: [],
    createdWithJournal: false,
  };
  let resources;
  const request = async (method, path, body) => {
    state.calls.push({ method, path, body });
    const changed = await override(method, path, body, state);
    if (changed) return changed;
    if (path === "/apps" && method === "POST") {
      const saved = JSON.parse(await readFile(resources.reportFile, "utf8"));
      state.createdWithJournal = saved.attempted;
      state.app = {
        name: body.app_name,
        organization: { slug: body.org_slug },
      };
      return ok(state.app);
    }
    if (path === resources.path) {
      if (method === "GET") return state.app ? ok(state.app) : absent();
      if (method === "DELETE") {
        state.app = null;
        return ok(null);
      }
    }
    if (path === resources.path + "/machines") {
      if (method === "GET") return ok(state.machines);
      if (method === "POST") {
        const saved = JSON.parse(await readFile(resources.reportFile, "utf8"));
        assert.equal(saved.machines.at(-1).name, body.name);
        const machine = {
          id: "1234567890abcd",
          name: body.name,
          config: body.config,
          state: "created",
        };
        state.machines.push(machine);
        return ok(machine);
      }
    }
    const match = state.machines.find((m) =>
      path.startsWith(resources.path + "/machines/" + m.id),
    );
    if (match) {
      if (method === "GET") return ok(match);
      if (method === "DELETE") {
        state.machines = state.machines.filter((m) => m !== match);
        return ok(null);
      }
    }
    if (path.startsWith(resources.path + "/machines/") && method === "GET")
      return absent();
    throw new Error(`Unexpected test request ${method} ${path}`);
  };
  resources = await flyProofResources(request, "personal", { directoryRoot });
  resources.report.plan.approved = true;
  return { resources, state, request, directoryRoot };
}

test("Fly transport keeps credentials on the fixed API and bounds provider replies", async () => {
  const calls = [];
  const api = flyApi("fm2_private", {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ error: "private provider body" }), {
        status: 403,
      });
    },
  });
  await assert.rejects(requireFly(api, "GET", "/apps/owned"), /failed \(403\)/);
  assert.equal(calls[0].url, "https://api.machines.dev/v1/apps/owned");
  assert.equal(calls[0].options.headers.Authorization, "FlyV1 fm2_private");
  assert.equal(calls[0].options.redirect, "error");
  await assert.rejects(api("GET", "https://other.invalid"), /Invalid/);
  assert.equal(calls.length, 1);
  const oversized = flyApi("private", {
    fetchImpl: async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
  });
  await assert.rejects(oversized("GET", "/apps/owned"), /byte limit/);
});

test("Fly journals before effects, removes each guest and confirms application absence", async (t) => {
  const { resources, state } = await fixture(t);
  await resources.createApp();
  assert.equal(state.createdWithJournal, true);
  const machine = await resources.createMachine([]);
  await assert.rejects(resources.createMachine([]), /earlier Machine/);
  await resources.removeMachine(machine);
  await resources.cleanup();
  const report = JSON.parse(await readFile(resources.reportFile, "utf8"));
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.machines[0].removed, true);
  assert.equal(state.app, null);
});

test("Fly preserves a conflicting application when creation is rejected", async (t) => {
  const { resources, state } = await fixture(t, (method, path, body, state) => {
    if (method === "POST" && path === "/apps") {
      state.app = {
        name: body.app_name,
        organization: { slug: body.org_slug },
      };
      return { ok: false, status: 409, data: null };
    }
  });
  await assert.rejects(resources.createApp(), /409/);
  await resources.cleanup();
  assert.ok(state.app);
  assert.equal(state.calls.filter((c) => c.method === "DELETE").length, 0);
});

test("Fly retains pending cleanup after an uncertain create and recovery cannot create again", async (t) => {
  let failCreate = true;
  const { resources, state, request, directoryRoot } = await fixture(
    t,
    (method, path, body, state) => {
      if (method === "POST" && path.endsWith("/machines") && failCreate) {
        failCreate = false;
        state.machines.push({
          id: "1234567890abcd",
          name: body.name,
          config: body.config,
          state: "created",
        });
        throw new Error("lost creation response");
      }
    },
  );
  await resources.createApp();
  await assert.rejects(resources.createMachine([]), /lost creation/);
  assert.equal(resources.report.cleanupVerified, false);
  const resumed = await flyProofResources(request, "personal", {
    resumeReport: resources.reportFile,
    directoryRoot,
  });
  await assert.rejects(resumed.createMachine([]), /Cleanup-only/);
  await resumed.cleanup();
  assert.equal(state.machines.length, 0);
  assert.equal(resumed.report.cleanupVerified, true);
});

test("Fly preserves foreign guests and refuses unconfirmed deletion", async (t) => {
  let ignoreDelete = true;
  const { resources, state } = await fixture(t, (method, path) =>
    method === "DELETE" && path.includes("/machines/") && ignoreDelete
      ? ok(null)
      : null,
  );
  await resources.createApp();
  const machine = await resources.createMachine([]);
  await assert.rejects(resources.removeMachine(machine), /not confirmed/);
  assert.equal(resources.report.cleanupVerified, false);
  machine.config.metadata.restyle_proof = "foreign";
  await assert.rejects(resources.cleanup(), /Unexpected Machine/);
  machine.config.metadata.restyle_proof = resources.report.id;
  ignoreDelete = false;
  await resources.cleanup();
  assert.equal(state.machines.length, 0);
});

test("Fly checks immutable identity, withholds source until ready and rejects malformed output", async () => {
  const bodies = [];
  const resources = {
    path: "/apps/owned",
    request: async (method, path, body) => {
      if (path.endsWith("/exec")) {
        bodies.push(body);
        return ok({
          stdout: JSON.stringify({
            status: 200,
            body: JSON.stringify({
              nodeVersion: NODE_RUNTIME.nodeVersion,
              runnerDigest: NODE_RUNTIME.runnerDigest,
            }),
          }),
        });
      }
      return ok({
        state: "started",
        image_ref: { digest: NODE_RUNTIME.baseImage.split("@")[1] },
      });
    },
  };
  const machine = new FlyProofMachine(resources, { id: "1234567890abcd" });
  await machine.start();
  assert.equal(
    bodies[0].cmd,
    "'node' '/runtime/bridge.mjs' '" +
      Buffer.from(JSON.stringify({ path: "/ready" })).toString("base64") +
      "'",
  );
  assert.equal("stdin" in bodies[0], false);
  resources.request = async () =>
    ok({ exit_code: 0, stdout: JSON.stringify({ status: 999, body: "{}" }) });
  await assert.rejects(machine.execute({ files: [] }, { input: {} }), {
    code: "invalid_reply",
  });
  resources.request = async () => {
    throw Object.assign(new Error("request expired"), { name: "TimeoutError" });
  };
  await assert.rejects(machine.execute({ files: [] }, { input: {} }), {
    code: "timeout",
  });
  resources.request = async () =>
    ok({ state: "started", image_ref: { digest: "wrong" } });
  await assert.rejects(machine.start(), /different Node base/);
});

test("Fly reports an account billing block without storing provider text", async (t) => {
  const { resources, state } = await fixture(t, (method, path) =>
    method === "POST" && path === "/apps"
      ? {
          ok: false,
          status: 422,
          data: {
            error: "Your account has overdue invoices. private account link",
          },
        }
      : null,
  );
  await assert.rejects(resources.createApp(), /payment is past due/);
  await resources.cleanup();
  assert.equal(resources.report.creationBlocker, "billing_past_due");
  assert.equal(state.machines.length, 0);
  assert.equal(
    (await readFile(resources.reportFile, "utf8")).includes(
      "private account link",
    ),
    false,
  );
});

test("Fly waits for initial creation to settle before starting a Machine", async () => {
  let state = "created";
  let inspections = 0;
  let starts = 0;
  const resources = {
    path: "/apps/owned",
    request: async (method, path) => {
      if (path.endsWith("/start")) {
        assert.equal(state, "stopped");
        starts++;
        state = "started";
        return ok({});
      }
      if (path.endsWith("/exec"))
        return ok({
          stdout: JSON.stringify({
            status: 200,
            body: JSON.stringify({
              nodeVersion: NODE_RUNTIME.nodeVersion,
              runnerDigest: NODE_RUNTIME.runnerDigest,
            }),
          }),
        });
      if (++inspections === 2) state = "stopped";
      return ok({
        state,
        image_ref: { digest: NODE_RUNTIME.baseImage.split("@")[1] },
      });
    },
  };
  await new FlyProofMachine(resources, { id: "1234567890abcd" }).start();
  assert.equal(starts, 1);
});

test("Fly guest bridge receives bounded UTF-8 input through encoded arguments", async () => {
  const body = JSON.stringify({
    input: "日本語 '';$(not-a-command)".repeat(3000),
  });
  const encoded = Buffer.from(
    JSON.stringify({ path: "/execute", body }),
  ).toString("base64");
  const chunks = encoded.match(/.{1,65536}/g);
  assert.ok(chunks.length > 1);
  const bootstrap =
    "globalThis.fetch=async(url,options)=>new Response(JSON.stringify({url,body:options.body}));";
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    "data:text/javascript," + encodeURIComponent(bootstrap),
    new URL("../../scripts/checks/node-runtime/fly/bridge.mjs", import.meta.url)
      .pathname,
    ...chunks,
  ]);
  const response = JSON.parse(stdout);
  // The wire output remains bounded even if its echoed input would be too large.
  assert.equal(response.status, 413);
  const small = Buffer.from(
    JSON.stringify({ path: "/execute", body: "日本語 ';$(not-a-command)" }),
  ).toString("base64");
  const echoed = await promisify(execFile)(process.execPath, [
    "--import",
    "data:text/javascript," + encodeURIComponent(bootstrap),
    new URL("../../scripts/checks/node-runtime/fly/bridge.mjs", import.meta.url)
      .pathname,
    small,
  ]);
  assert.deepEqual(JSON.parse(JSON.parse(echoed.stdout).body), {
    url: "http://127.0.0.1:8080/execute",
    body: "日本語 ';$(not-a-command)",
  });
});
