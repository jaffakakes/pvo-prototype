import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { reserveAssistantUsage } from "../server/assistant/quota.js";

test("assistant accounting fails closed and stores daily address digests only", async () => {
  const request = new Request("https://example.test/api/assistant/turn", {
    headers: { "CF-Connecting-IP": "192.0.2.4" },
  });
  await assert.rejects(
    reserveAssistantUsage(request, {}),
    (error) => error.status === 503,
  );
  let scope;
  let digest;
  const env = {
    ASSISTANT_BUDGET: {
      getByName(name) {
        scope = name;
        return {
          reserve(key) {
            digest = key;
            return true;
          },
        };
      },
    },
  };
  await reserveAssistantUsage(request, env);
  assert.match(scope, /^assistant:\d{4}-\d{2}-\d{2}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.ok(!digest.includes("192.0.2.4"));
  env.ASSISTANT_BUDGET.getByName = () => ({ reserve: () => false });
  await assert.rejects(
    reserveAssistantUsage(request, env),
    (error) => error.status === 503,
  );
  await assert.rejects(
    reserveAssistantUsage(new Request(request.url), env),
    (error) => error.status === 503,
  );
});

test("unlimited requests retain exact usage, replay and cancellation fences through restart and expiry", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import { AssistantBudget } from "./server/assistant/budget.js";
    export class RecordedBudget extends AssistantBudget {
      now() { return Date.UTC(2100, 0, 1); }
      expire() { return this.alarm(); }
      usage() {
        return {
          counts: this.ctx.storage.sql.exec("SELECT * FROM counts ORDER BY key").toArray(),
          reservations: this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM reservations").one().count,
        };
      }
      async batch(key, count) {
        for (let i = 1; i <= count; i++) {
          const result = await this.reserveTask(key, i.toString(16).padStart(64, "0"));
          if (!result.accepted) return { failedAt: i, ...result };
        }
        return { accepted: true };
      }
    }
    export default { async fetch(request, env) {
      const { method, args = [] } = await request.json();
      return Response.json((await env.BUDGET.getByName("same-day")[method](...args)) ?? null);
    } };`,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers"],
  });
  const persist = await mkdtemp(join(tmpdir(), "pvo-assistant-budget-"));
  const options = () =>
    convertV4MiniflareOptions({
      name: "assistant-budget-test",
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-09-27",
      durableObjects: {
        BUDGET: { className: "RecordedBudget", useSQLite: true },
      },
      isolatedResourcePersistencePath: persist,
      resourcePersistencePath: persist,
    });
  let mf = new Miniflare(options());
  const key = "a".repeat(64),
    other = "b".repeat(64);
  const operation = (n) => n.toString(16).padStart(64, "0");
  const call = async (method, ...args) => {
    const response = await mf.dispatchFetch("https://budget.test/", {
      method: "POST",
      body: JSON.stringify({ method, args }),
    });
    assert.equal(
      response.status,
      200,
      `${method}: ${await response.clone().text()}`,
    );
    return response.json();
  };
  const total = async () =>
    (await call("usage")).counts.find((row) => row.key === "global").total;
  try {
    const foreground = await Promise.all(
      Array.from({ length: 80 }, () => call("reserve", key)),
    );
    assert.ok(
      foreground.every(Boolean),
      "The same client can exceed the former minute, client and global daily caps",
    );
    assert.deepEqual(
      await call("batch", key, 4100),
      { accepted: true },
      "Saved work continues beyond the old reservation table cap",
    );
    assert.equal(await total(), 4180);
    const replay = await Promise.all(
      Array.from({ length: 8 }, () => call("reserveTask", key, operation(1))),
    );
    assert.ok(replay.every((result) => result.accepted));
    assert.equal(await total(), 4180, "Concurrent replay is counted once");
    assert.equal(await call("settle", other, operation(1), false), false);
    assert.equal(
      (await call("reserveTask", other, operation(1))).reason,
      "reservation_closed",
    );
    assert.equal(await call("settle", key, operation(1), true), true);
    assert.equal(
      await call("settle", key, operation(1), false),
      false,
      "Consumed work cannot be refunded",
    );
    assert.equal(await call("settle", key, operation(2), false), true);
    assert.equal(await call("settle", key, operation(2), false), true);
    assert.equal(await total(), 4179, "Unused work is refunded only once");
    const cancelled = operation(5000);
    assert.equal(await call("settle", key, cancelled, false), true);
    assert.equal(
      (await call("reserveTask", key, cancelled)).reason,
      "reservation_closed",
      "Cancellation arriving before reserve is retained even above 4096 rows",
    );
    const before = await call("usage");
    await mf.dispose();
    mf = new Miniflare(options());
    assert.deepEqual(await call("usage"), before);
    assert.deepEqual(await call("reserveTask", key, operation(1)), {
      accepted: true,
    });
    assert.equal(
      (await call("reserveTask", key, operation(2))).reason,
      "reservation_closed",
    );
    assert.equal(
      (await call("reserveTask", key, cancelled)).reason,
      "reservation_closed",
    );
    assert.equal(await call("settle", key, operation(5001), true), false);
    assert.equal(
      await call("reserve", key),
      true,
      "Restart retains accounting without imposing a request cutoff",
    );
    assert.equal(await total(), 4180);
    assert.equal(await call("reserve", "raw-address"), false);
    assert.equal(await call("settle", key, "invalid", false), false);
    await call("expire");
    await mf.dispose();
    mf = new Miniflare(options());
    assert.deepEqual(
      await call("usage"),
      { counts: [], reservations: 0 },
      "Day expiry deletes accounting and reservation data",
    );
  } finally {
    await mf.dispose();
    assert.ok(resolve(persist).startsWith(resolve(tmpdir()) + sep));
    await rm(persist, { recursive: true, force: true });
  }
});
