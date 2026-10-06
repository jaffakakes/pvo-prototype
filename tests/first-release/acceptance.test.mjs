import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import {
  reportedUsage,
  validateModelRequest,
  MODEL_LIMITS,
} from "../../scripts/checks/cloud-agent-first-release/meter.js";
import { scenarioInput } from "../../scripts/checks/cloud-agent-first-release/scenarios.js";
import { parseTaskInput } from "../../packages/pvo-assistant/tasks/index.js";

test("acceptance starts from ordinary requests with no injected program or decision", () => {
  for (const subject of ["dinner", "equipment"]) {
    const input = parseTaskInput(scenarioInput(subject, "project-one"));
    assert.ok(input.request.length > 100);
    assert.deepEqual(input.context.components, []);
    assert.ok(input.examples.length >= 2);
  }
});

test("paid transport rejects a changed provider/model or unbounded output", () => {
  const url =
    "https://api.runpod.ai/v2/moonshot-kimi/openai/v1/chat/completions";
  const payload = {
    model: "kimi-k2.6",
    stream: false,
    max_tokens: 6000,
    thinking: { type: "disabled" },
  };
  const init = (body) => ({
    method: "POST",
    redirect: "manual",
    body: JSON.stringify(body),
  });
  validateModelRequest(url, init(payload));
  assert.throws(() => validateModelRequest(url + "/other", init(payload)));
  assert.throws(() =>
    validateModelRequest(url, init({ ...payload, model: "other" })),
  );
  assert.throws(() =>
    validateModelRequest(url, init({ ...payload, max_tokens: 6001 })),
  );
  assert.throws(() =>
    validateModelRequest(url, { ...init(payload), redirect: "follow" }),
  );
  assert.deepEqual(
    reportedUsage({ usage: { prompt_tokens: 1000, completion_tokens: 100 } }),
    { inputTokens: 1000, outputTokens: 100, estimatedMicros: 1350 },
  );
  assert.equal(
    reportedUsage({ usage: { prompt_tokens: -1, completion_tokens: 5 } }),
    null,
  );
});

test("actual diagnostic stores ordinary tasks, rejects unowned access and retains cost reservations through restart", async () => {
  const modules = await bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    export * from './scripts/checks/cloud-agent-first-release/worker.js';
    import worker from './scripts/checks/cloud-agent-first-release/worker.js';
    export default { async fetch(request,env) {
      const path = new URL(request.url).pathname;
      if(path === '/ledger') {
        const {action,args=[]} = await request.json();
        try { return Response.json((await env.PROOF_CONTROL.getByName('global')[action](...args)) ?? null); }
        catch { return new Response(null,{status:409}); }
      }
      if(path === '/wrong-owner') {
        try {
          return Response.json(await env.ASSISTANT_TASKS.getByName('owner:proof-local-dinner').execute('another-owner',{kind:'project',input:{localId:'dinner'}}));
        } catch { return new Response(null,{status:404}); }
      }
      return worker.fetch(request,env);
    }};`,
    },
  });
  const persist = await mkdtemp(join(tmpdir(), "restyle-first-release-test-"));
  const expiresAt = Date.now() + 60_000;
  const options = convertV4MiniflareOptions({
    name: "acceptance-test",
    modules,
    compatibilityDate: "2026-10-03",
    bindings: {
      PROOF_ID: "local",
      PUBLIC_ORIGIN: "https://acceptance.test",
      PROOF_TOKEN: "local-token",
      PROOF_EXPIRES_AT: String(expiresAt),
      ASSISTANT_PROVIDER: "runpod",
      ASSISTANT_TASK_SPENDING: "[]",
    },
    durableObjects: Object.fromEntries(
      Object.entries({
        ASSISTANT_TASKS: "AcceptanceTasks",
        ASSISTANT_BUDGET: "AssistantBudget",
        ASSISTANT_WORKSPACES: "AcceptanceWorkspace",
        WORKSPACE_BUDGET: "WorkspaceBudget",
        SERVICE_HOSTS: "HostedService",
        PROOF_CONTROL: "AcceptanceControl",
      }).map(([name, className]) => [name, { className, useSQLite: true }]),
    ),
    isolatedResourcePersistencePath: persist,
    resourcePersistencePath: persist,
    outboundService: () => {
      throw new Error("No network or paid model calls in local acceptance.");
    },
  });
  let mf;
  const start = async () => {
    mf = new Miniflare(options);
    await mf.ready;
  };
  const call = (path, method = "GET", body, auth = true) =>
    mf.dispatchFetch(`https://acceptance.test${path}`, {
      method,
      headers: auth
        ? {
            Authorization: "Bearer local-token",
            "Content-Type": "application/json",
          }
        : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const ledger = async (action, ...args) => {
    const response = await call("/ledger", "POST", { action, args });
    return {
      status: response.status,
      body: response.status === 200 ? await response.json() : null,
    };
  };
  try {
    await start();
    assert.equal((await call("/health", "GET", null, false)).status, 401);
    assert.equal(
      (await call("/dinner/begin", "POST", null, false)).status,
      401,
    );
    const first = await (await call("/dinner/begin", "POST")).json();
    assert.ok(first.task?.id, JSON.stringify(first));
    const repeat = await (await call("/dinner/begin", "POST")).json();
    assert.equal(repeat.task.id, first.task.id);
    const bridged = await (
      await call("/dinner/api", "POST", {
        path: `/api/assistant/tasks/${first.task.id}`,
        method: "GET",
      })
    ).json();
    assert.equal(bridged.status, 200);
    assert.equal(bridged.body.task.id, first.task.id);
    const foreign = await (
      await call("/equipment/api", "POST", {
        path: `/api/assistant/tasks/${first.task.id}`,
        method: "GET",
      })
    ).json();
    assert.equal(foreign.status, 404);
    assert.equal(
      (
        await call(
          "/dinner/api",
          "POST",
          { path: "/api/assistant/tasks", method: "GET" },
          false,
        )
      ).status,
      401,
    );
    assert.equal((await call("/wrong-owner")).status, 404);
    const snapshot = await (await call("/dinner/status")).json();
    assert.equal(snapshot.task.id, first.task.id);
    assert.equal(
      snapshot.task.input.request,
      scenarioInput("dinner", "unused").request,
    );
    const reserved = await ledger("reserve", expiresAt);
    assert.equal(reserved.status, 200);
    await ledger("settle", reserved.body, 200, {
      inputTokens: 100,
      outputTokens: 50,
      estimatedMicros: 295,
    });
    await mf.dispose();
    await start();
    const report = (await ledger("report")).body;
    assert.equal(report.models.length, 1);
    assert.equal(report.models[0].reserved, MODEL_LIMITS.reservationMicros);
    const max = Math.floor(
      MODEL_LIMITS.allowanceMicros / MODEL_LIMITS.reservationMicros,
    );
    for (let i = 1; i < max; i++)
      assert.equal((await ledger("reserve", expiresAt)).status, 200);
    assert.equal((await ledger("reserve", expiresAt)).status, 409);
    assert.equal((await ledger("reserve", Date.now() - 1)).status, 409);
    assert.equal(
      (await (await call("/dinner/status")).json()).task.id,
      first.task.id,
    );
    if (process.env.CHECK_ACCEPTANCE_BROWSER === "1") {
      const { openCreatorJourney } =
        await import("../../scripts/checks/cloud-agent-first-release/browser.mjs");
      const journey = await openCreatorJourney({
        origin: "https://acceptance.test",
        sourceUrl: process.env.EDITOR_URL || "http://127.0.0.1:5318/",
        proofId: "local",
        call: async (...args) => {
          const response = await call(...args);
          return { status: response.status, data: await response.json() };
        },
        record: async () => {},
      });
      try {
        const created = await journey.start("equipment");
        assert.equal(created.status, 200);
        assert.equal(
          created.data.task.input.request,
          scenarioInput("equipment", "unused").request,
        );
        assert.notEqual(
          created.data.task.input.context.fingerprint,
          "1f-empty-scene",
        );
      } finally {
        await journey.close();
      }
    }
    const cleaned = await (await call("/", "DELETE")).json();
    assert.equal(cleaned.stopped.length, 2);
    assert.equal(cleaned.usage.models.length, max);
  } finally {
    await mf?.dispose();
    await rm(persist, { recursive: true, force: true });
  }
});
