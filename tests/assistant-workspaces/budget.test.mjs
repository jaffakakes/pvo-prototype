import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_LIMITS as limits } from "../../packages/pvo-assistant/workspaces/index.js";
import { identity, NOW, workspaceFixture } from "./helpers.mjs";

async function lease(number, now = NOW, expiresAt = NOW + 86_400_000) {
  const { resourceId } = await identity(`task-${number}`);
  return {
    id: `${resourceId}-1`,
    resourceId,
    session: 1,
    sourceRevision: 1,
    startedAt: now,
    deadlineAt: now + limits.sessionMs,
    expiresAt,
  };
}
const result = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.result && typeof response.result === "object"
    ? response.result.accepted
    : response.result;
};

test("global workspace reservations survive restart, cap concurrent owners and never infer cleanup from time", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  const call = (action, input, extra = {}) =>
    f.call(action, who, input, { budget: true, ...extra });
  try {
    const a = await lease(1),
      b = await lease(2),
      c = await lease(3);
    const concurrent = await Promise.all([
      call("reserve", a),
      call("reserve", b),
      call("reserve", c),
    ]);
    assert.equal(concurrent.filter((x) => result(x)).length, 2);
    assert.ok(
      concurrent.some(
        (response) =>
          response.result.reason === "workspace_capacity" &&
          response.result.retryAt === NOW + 30000,
      ),
    );
    const accepted = [a, b, c].filter((_, i) => concurrent[i].result.accepted);
    const rejected = [a, b, c].find((_, i) => !concurrent[i].result.accepted);
    await f.restart();
    assert.equal(result(await call("reserve", accepted[0])), true);
    result(await call("time", null, { now: NOW + limits.sessionMs + 1 }));
    assert.equal(
      result(await call("reserve", await lease(4, NOW + limits.sessionMs + 1))),
      false,
    );
    result(await call("time", null, { now: NOW }));
    result(await call("release", accepted[0]));
    assert.equal(result(await call("reserve", accepted[0])), false);
    assert.equal(result(await call("reserve", rejected)), true);
    assert.equal(
      (await call("reserve", { ...accepted[1], sourceRevision: 2 })).status,
      409,
    );
  } finally {
    await f.close();
  }
});

test("unlimited daily workspace starts retain accounting, replay and cancellation fences across restart", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  const call = (action, input, extra = {}) =>
    f.call(action, who, input, { budget: true, ...extra });
  try {
    const cancelled = await lease(0);
    result(await call("release", cancelled));
    assert.equal(result(await call("reserve", cancelled)), false);
    for (const start of [1, 2051]) {
      const leases = await Promise.all(
        Array.from({ length: 2050 }, (_, index) => lease(start + index)),
      );
      assert.equal(result(await call("batch", leases)), true);
      await f.restart();
    }
    assert.equal((await call("usage")).result, 4100);
    const lateCancelled = await lease(4101);
    result(await call("release", lateCancelled));
    await f.restart();
    assert.equal(result(await call("reserve", lateCancelled)), false);
    assert.equal((await call("usage")).result, 4100);
    const tomorrow = NOW + 86_400_000;
    result(await call("time", null, { now: tomorrow }));
    result(await call("alarm"));
    assert.equal(result(await call("reserve", cancelled)), false);
    assert.equal(
      result(
        await call(
          "reserve",
          await lease(101, tomorrow, tomorrow + 86_400_000),
        ),
      ),
      true,
    );
  } finally {
    await f.close();
  }
});
