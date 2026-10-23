import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { MODEL_LIMITS } from "../../scripts/checks/cloud-agent-first-release/meter.js";

test("the separate diagnostic spending policy retains known and unknown cost reservations through restart", async () => {
  const modules = await bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    export { AcceptanceControl } from './scripts/checks/cloud-agent-first-release/control.js';
    export default { async fetch(request,env) {
      const input=await request.json();
      const value=await env.METER.getByName('global')[input.action](...(input.args??[]));
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
  const meter = (action, ...args) => request({ kind: "meter", action, args });
  try {
    await start();
    const known = await meter("reserve", expiresAt);
    await meter("settle", known, 200, {
      inputTokens: 100,
      outputTokens: 50,
      estimatedMicros: 295,
    });
    const secondKnown = await meter("reserve", expiresAt);
    await meter("settle", secondKnown, 200, {
      inputTokens: 100,
      outputTokens: 50,
      estimatedMicros: 295,
    });
    const max = Math.floor(
      MODEL_LIMITS.allowanceMicros / MODEL_LIMITS.reservationMicros,
    );
    for (let i = 2; i < max; i++) await meter("reserve", expiresAt);
    await mf.dispose();
    policy = "settled-usage";
    await start();
    const unknownAllowed = Math.floor(
      (MODEL_LIMITS.allowanceMicros - 590) / MODEL_LIMITS.reservationMicros,
    );
    assert.ok(unknownAllowed > max - 2);
    for (let i = max - 2; i < unknownAllowed; i++)
      await meter("reserve", expiresAt);
    const report = await meter("report");
    assert.equal(
      report.models.length,
      unknownAllowed + 2,
      "Reported successful usage frees only the unused dollars",
    );
    assert.equal(
      report.models.filter((value) => value.usage === null).length,
      unknownAllowed,
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
  } finally {
    await mf?.dispose();
    await rm(persist, { recursive: true, force: true });
  }
});
