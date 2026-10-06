import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { MODEL_LIMITS } from "../../scripts/checks/cloud-agent-first-release/meter.js";

test("the optional diagnostic policy preserves counts and burst admission while charging known usage and reserving unknown calls", async () => {
  const modules = await bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import { AcceptanceBudget } from './scripts/checks/cloud-agent-first-release/budget.js';
    export { AcceptanceControl } from './scripts/checks/cloud-agent-first-release/control.js';
    export class ClockedBudget extends AcceptanceBudget {
      now() { return this.testNow ?? Date.now(); }
      at(input) { this.testNow=input.now; return this.reserveTask(input.client,input.key); }
    }
    export default { async fetch(request,env) {
      const input=await request.json();
      const value=input.kind==='budget'
        ? await env.BUDGET.getByName('day').at(input)
        : await env.METER.getByName('global')[input.action](...(input.args??[]));
      return Response.json(value??null);
    } };`,
    },
  });
  const persist = await mkdtemp(join(tmpdir(), "restyle-diagnostic-capacity-"));
  const now = Math.ceil(Date.now() / 60000) * 60000;
  const expiresAt = now + 3600000;
  let policy = "",
    mf;
  const start = async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        name: "diagnostic-policy",
        modules,
        compatibilityDate: "2026-10-03",
        bindings: {
          PROOF_SPENDING_POLICY: policy,
          PROOF_EXPIRES_AT: String(expiresAt),
        },
        durableObjects: {
          BUDGET: { className: "ClockedBudget", useSQLite: true },
          METER: { className: "AcceptanceControl", useSQLite: true },
        },
        isolatedResourcePersistencePath: persist,
        resourcePersistencePath: persist,
        outboundService: () => {
          throw new Error("No paid calls in this test");
        },
      }),
    );
    await mf.ready;
  };
  const request = async (input) =>
    (
      await mf.dispatchFetch("https://test.local/", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).json();
  const key = (value) => value.toString(16).padStart(64, "0");
  const budget = (index, time) =>
    request({ kind: "budget", client: key(999), key: key(index), now: time });
  const meter = (action, ...args) => request({ kind: "meter", action, args });
  try {
    await start();
    for (let i = 0; i < 20; i++)
      assert.equal(
        (await budget(i, now + Math.floor(i / 12) * 60000)).accepted,
        true,
      );
    assert.equal((await budget(20, now + 120000)).reason, "model_allowance");
    const known = await meter("reserve", expiresAt);
    await meter("settle", known, 200, {
      inputTokens: 100,
      outputTokens: 50,
      estimatedMicros: 295,
    });
    const max = Math.floor(
      MODEL_LIMITS.allowanceMicros / MODEL_LIMITS.reservationMicros,
    );
    for (let i = 1; i < max; i++) await meter("reserve", expiresAt);
    await mf.dispose();
    policy = "settled-usage";
    await start();
    assert.equal((await budget(20, now + 120000)).accepted, true);
    assert.equal(
      (await budget(20, now + 120000)).accepted,
      true,
      "Reservation replay must not double-charge capacity",
    );
    const simultaneous = await Promise.all(
      Array.from({ length: 15 }, (_, i) => budget(21 + i, now + 120000)),
    );
    assert.equal(
      simultaneous.filter((value) => value.accepted).length,
      11,
      "The unchanged twelve-per-minute limit still applies",
    );
    await meter("reserve", expiresAt);
    const report = await meter("report");
    assert.equal(
      report.models.length,
      max + 1,
      "Reported successful usage frees only the unused dollars",
    );
    assert.equal(
      report.models.filter((value) => value.usage === null).length,
      max,
    );
    assert.equal(
      report.models.find((value) => value.id === known).usage.estimatedMicros,
      295,
    );
    // Unknown outcomes still reserve the complete amount: another reservation must fail.
    const reply = await mf.dispatchFetch("https://test.local/", {
      method: "POST",
      body: JSON.stringify({
        kind: "meter",
        action: "reserve",
        args: [expiresAt],
      }),
    });
    assert.equal(reply.status, 500);
    assert.equal(
      (await budget(99, expiresAt)).reason,
      "model_allowance",
      "An expired opt-in restores ordinary capacity",
    );
  } finally {
    await mf?.dispose();
    await rm(persist, { recursive: true, force: true });
  }
});
