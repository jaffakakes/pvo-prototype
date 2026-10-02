import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { reserveAssistantUsage } from "../server/assistant/quota.js";

test("assistant quota fails closed and stores daily address digests only", async () => {
  const request = new Request("https://example.test/api/assistant/turn", { headers: { "CF-Connecting-IP": "192.0.2.4" } });
  await assert.rejects(reserveAssistantUsage(request, {}), error => error.status === 503);
  let scope;
  let digest;
  const env = { ASSISTANT_BUDGET: { getByName(name) {
    scope = name;
    return { reserve(key) { digest = key; return true; } };
  } } };
  await reserveAssistantUsage(request, env);
  assert.match(scope, /^assistant:\d{4}-\d{2}-\d{2}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.ok(!digest.includes("192.0.2.4"));
  env.ASSISTANT_BUDGET.getByName = () => ({ reserve: () => false });
  await assert.rejects(reserveAssistantUsage(request, env), error => error.status === 429);
  await assert.rejects(reserveAssistantUsage(new Request(request.url), env), error => error.status === 503);
});

test("inference reservations enforce concurrent burst/global caps and survive restarts", async () => {
  const bundle = await build({ stdin: {
    contents: `export { AssistantBudget } from "./server/assistant/budget.js";
      export default { async fetch(request, env) {
        const url = new URL(request.url);
        return Response.json(await env.BUDGET.getByName(url.pathname).reserve(url.searchParams.get("key")));
      } };`, resolveDir: process.cwd(),
  }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers"] });
  const persist = await mkdtemp(join(tmpdir(), "pvo-assistant-budget-"));
  const options = () => convertV4MiniflareOptions({ name: "assistant-budget-test", modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: "2026-09-27",
    durableObjects: { BUDGET: { className: "AssistantBudget", useSQLite: true } },
    isolatedResourcePersistencePath: persist, resourcePersistencePath: persist,
  });
  let mf = new Miniflare(options());
  const reserve = async (day, key) => (await mf.dispatchFetch(`https://budget.test/${day}?key=${key}`)).json();
  const key = number => number.toString(16).padStart(64, "0");
  try {
    const burst = await Promise.all(Array.from({ length: 9 }, () => reserve("burst", key(1))));
    assert.equal(burst.filter(Boolean).length, 4);
    const daily = await Promise.all(Array.from({ length: 80 }, (_, index) => reserve("daily", key(index + 1))));
    assert.equal(daily.filter(Boolean).length, 60, "Parallel reservations cannot overspend the daily budget");
    await mf.dispose();
    mf = new Miniflare(options());
    assert.equal(await reserve("daily", key(999)), false, "Restart must retain the spent budget");
    assert.equal(await reserve("new-day", key(999)), true, "The next day has an independent allowance");
    assert.equal(await reserve("new-day", "raw-address"), false);
  } finally {
    await mf.dispose();
    assert.ok(resolve(persist).startsWith(resolve(tmpdir()) + sep));
    assert.ok(persist.includes("pvo-assistant-budget-"));
    await rm(persist, { recursive: true, force: true });
  }
});
