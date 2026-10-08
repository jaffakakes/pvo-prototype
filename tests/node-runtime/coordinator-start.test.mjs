import test from "node:test";
import assert from "node:assert/strict";
import { deferred, fixture, request } from "./coordinator.helpers.mjs";

test("cancelling an unfinished provider create holds capacity until it settles and is destroyed", async () => {
  const entered = deferred(),
    release = deferred();
  const calls = [];
  const f = await fixture(async (input) => {
    const { kind } = await input.json();
    calls.push(kind);
    if (kind === "start") {
      entered.resolve();
      await release.promise;
    }
    return Response.json({ result: "late", state: {} });
  });
  try {
    const running = f.call(request("starting"));
    await entered.promise;
    const stopped = f.call({ kind: "cancel", id: "starting" });
    let observed;
    for (let attempt = 0; attempt < 10; attempt++) {
      observed = await f.call({ kind: "inspect" });
      if (observed.lease?.phase === "cleanup") break;
    }
    assert.equal(observed.lease?.phase, "cleanup");
    assert.deepEqual(calls, ["start"]);
    assert.equal(
      (await f.call(request("competing"))).code,
      "execution_capacity",
    );
    release.resolve();
    assert.equal((await stopped).closed, true);
    assert.equal((await running).ok, false);
    assert.deepEqual(calls, ["start", "destroy"]);
    assert.equal((await f.call({ kind: "inspect" })).lease, null);
    assert.equal((await f.call(request("replacement"))).ok, true);
  } finally {
    release.resolve();
    await f.close();
  }
});

test("an asynchronous create rejection still owns cleanup and never executes source", async () => {
  const calls = [];
  const f = await fixture(async (input) => {
    const { kind } = await input.json();
    calls.push(kind);
    return Response.json(kind === "start" ? { fail: true } : {});
  });
  try {
    const result = await f.call(request("rejected"));
    assert.equal(result.code, "execution_failed");
    assert.deepEqual(calls, ["start", "destroy"]);
    assert.equal((await f.call({ kind: "inspect" })).lease, null);
    assert.equal((await f.call(request("rejected"))).code, "execution_closed");
  } finally {
    await f.close();
  }
});
