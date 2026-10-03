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

test("one maximum task fits the minute budget while concurrent and daily limits survive restarts", async () => {
  const bundle = await build({ stdin: {
    contents: `import { AssistantBudget } from "./server/assistant/budget.js";
      export class ClockedAssistantBudget extends AssistantBudget {
        reserveAt(key, now) {
          const original = Date.now;
          Date.now = () => now;
          // reserve reads time synchronously; restore it before its storage await.
          try { return super.reserve(key); }
          finally { Date.now = original; }
        }
      }
      export default { async fetch(request, env) {
        const url = new URL(request.url);
        return Response.json(await env.BUDGET.getByName(url.pathname).reserveAt(
          url.searchParams.get("key"), Number(url.searchParams.get("now"))));
      } };`, resolveDir: process.cwd(),
  }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers"] });
  const persist = await mkdtemp(join(tmpdir(), "pvo-assistant-budget-"));
  const options = () => convertV4MiniflareOptions({ name: "assistant-budget-test", modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: "2026-09-27",
    durableObjects: { BUDGET: { className: "ClockedAssistantBudget", useSQLite: true } },
    isolatedResourcePersistencePath: persist, resourcePersistencePath: persist,
  });
  let mf = new Miniflare(options());
  // Future fixed time keeps storage-expiry alarms from firing during the test.
  const firstMinute = Date.UTC(2100, 0, 1);
  const reserve = async (day, key, now = firstMinute) =>
    (await mf.dispatchFetch(`https://budget.test/${day}?key=${key}&now=${now}`)).json();
  const key = number => number.toString(16).padStart(64, "0");
  try {
    const taskRequests = ["turn", "transcribe", "turn", "align", "turn", "track",
      "transcribe", "turn", "align", "turn", "track", "turn"];
    for (const request of taskRequests)
      assert.equal(await reserve("task", key(1)), true, `${request} must fit within a six-turn/six-observation task`);
    assert.equal(await reserve("task", key(1)), false, "The thirteenth request in the same minute is rejected");
    const burst = await Promise.all(Array.from({ length: 20 }, () => reserve("burst", key(1))));
    assert.equal(burst.filter(Boolean).length, 12, "Concurrent reservations cannot overspend the minute allowance");
    const secondMinute = await Promise.all(Array.from({ length: 12 }, () => reserve("task", key(1), firstMinute + 60_000)));
    assert.equal(secondMinute.filter(Boolean).length, 8, "Only eight daily requests remain after the maximum task");
    assert.equal(await reserve("task", key(1), firstMinute + 120_000), false, "Another minute does not reset the twenty-request client daily cap");
    const daily = await Promise.all(Array.from({ length: 80 }, (_, index) => reserve("daily", key(index + 1))));
    assert.equal(daily.filter(Boolean).length, 60, "Parallel reservations cannot overspend the daily budget");
    await mf.dispose();
    mf = new Miniflare(options());
    assert.equal(await reserve("task", key(1), firstMinute + 180_000), false, "Restart must retain the client daily cap");
    assert.equal(await reserve("burst", key(1)), false, "Restart must retain the current minute's spent allowance");
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
