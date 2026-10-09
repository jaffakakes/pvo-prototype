import assert from "node:assert/strict";
import test from "node:test";
import { assistantDailyCapacity } from "../server/assistant/dailyCapacity.js";

const now = Date.UTC(2100, 0, 1);
const policy = { global: 300, client: 100, expiresAt: now + 3600000 };

test("trusted capacity changes expire and malformed policies retain the default allowance", () => {
  assert.deepEqual(assistantDailyCapacity(JSON.stringify(policy), now), {
    global: 300,
    client: 100,
  });
  for (const encoded of [
    undefined,
    "not-json",
    "x".repeat(257),
    "[]",
    "null",
    JSON.stringify({ ...policy, extra: true }),
    JSON.stringify({ ...policy, global: 4097 }),
    JSON.stringify({ ...policy, client: 301 }),
    JSON.stringify({ ...policy, client: 0 }),
    JSON.stringify({ ...policy, client: 1.5 }),
    JSON.stringify({ ...policy, expiresAt: now }),
  ])
    assert.deepEqual(assistantDailyCapacity(encoded, now), {
      global: 60,
      client: 20,
    });
  assert.deepEqual(
    assistantDailyCapacity(JSON.stringify(policy), policy.expiresAt),
    { global: 60, client: 20 },
  );
});
