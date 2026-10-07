import assert from "node:assert/strict";
import test from "node:test";
import { FlyCommands } from "../../server/cloud-services/node/fly/commands.js";
const ok = (data) => ({ ok: true, status: 200, data });

test("product commands retain bounded pacing and never dispatch expired or cancelled queued work", async () => {
  let now = 0;
  const calls = [];
  const commands = new FlyCommands(
    async (method, path, body) => {
      calls.push({ at: now, body });
      return ok({ stdout: "ok" });
    },
    "/apps/owned/machines/1234567890abcd",
    {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  );
  const results = await Promise.allSettled([
    commands.command(["fixed"]),
    commands.command(["expired"], { timeoutMs: 500 }),
    commands.command(["cancelled"], { signal: AbortSignal.abort() }),
    commands.command(["fixed"]),
  ]);
  assert.deepEqual(
    calls.map((x) => x.at),
    [0, 1100],
  );
  assert.equal(results[1].reason.code, "runtime_unavailable");
  assert.equal(results[2].status, "rejected");
});

test("a lost command reply is infrastructure uncertainty and is never executed a second time", async () => {
  let calls = 0;
  const commands = new FlyCommands(async () => {
    calls++;
    throw new TypeError("provider connection lost");
  }, "/apps/owned/machines/1234567890abcd");
  await assert.rejects(commands.bridge("execute"), {
    code: "runtime_unavailable",
  });
  assert.equal(calls, 1);
});

test("only the fixed host transport executes and untrusted command/reply status cannot claim a result", async () => {
  const replies = [
    ok({
      stdout: JSON.stringify({ status: 200, body: '{"value":"accepted"}' }),
    }),
    ok({ stdout: "", stderr: "provider payload failure" }),
    ok({ exit_signal: 9, stdout: '{"status":200,"body":"null"}' }),
    ok({ stdout: JSON.stringify({ status: 413, body: "" }) }),
    ok({ stdout: JSON.stringify({ status: 504, body: "" }) }),
  ];
  let now = 0;
  const commands = new FlyCommands(
    async (method, path, body) => {
      assert.equal(body.cmd, "'node' '/runtime/transport.mjs' '--execute'");
      return replies.shift();
    },
    "/apps/owned/machines/1234567890abcd",
    {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  );
  assert.deepEqual(await commands.bridge("execute"), { value: "accepted" });
  for (const code of [
    "invalid_reply",
    "execution_failed",
    "output_limit",
    "timeout",
  ])
    await assert.rejects(commands.bridge("execute"), { code });
});
