import assert from "node:assert/strict";
import test from "node:test";
import { api, setup, runner } from "./helpers.mjs";

test("export, download and publication recheck the same service without repeat activation", async () => {
  const f = await setup(),
    r = runner(f);
  await r.run();
  await r.run();
  await r.run();
  assert.equal(r.sent.length, 1);
  assert.equal(r.pending, null);
  assert.equal(r.current.service.liveReleaseId, f.identity.resourceId);
});

test("lost successful reply recovers the live release, without resetting or activating again", async () => {
  const f = await setup(),
    r = runner(f),
    send = r.adapters.send;
  r.adapters.send = async (...args) => {
    await send(...args);
    throw new Error("reply lost");
  };
  await assert.rejects(r.run(), /reply lost/);
  assert.equal(r.pending.control.actionId, "activation-1");
  r.adapters.send = send;
  await r.run();
  assert.equal(r.sent.length, 1);
  assert.equal(r.pending, null);
});

test("failure before commit retries the exact persisted command", async () => {
  const f = await setup(),
    r = runner(f),
    send = r.adapters.send,
    attempts = [];
  r.adapters.send = async (...args) => {
    attempts.push(structuredClone(args[0]));
    throw new Error("offline");
  };
  await assert.rejects(r.run(), /offline/);
  r.adapters.send = async (...args) => {
    attempts.push(structuredClone(args[0]));
    return send(...args);
  };
  await r.run();
  assert.deepEqual(attempts[1], attempts[0]);
});

test("no effect occurs unless the activation intent can be saved", async () => {
  const r = runner(await setup());
  r.adapters.save = () => {
    throw new Error("storage full");
  };
  await assert.rejects(r.run(), /storage full/);
  assert.equal(r.sent.length, 0);
});

test("later pause or version change blocks file and link delivery without undoing that control", async () => {
  const f = await setup(),
    r = runner(f);
  await r.run();
  r.current.service.state = "paused";
  await assert.rejects(r.run(), /paused/);
  r.current.service.state = "active";
  r.current.service.liveReleaseId = "release-" + "f".repeat(64);
  await assert.rejects(r.run(), /version changed/);
  assert.equal(r.sent.length, 1);
});

test("account/project replacement while checking prevents activation", async () => {
  const f = await setup(),
    r = runner(f),
    read = r.adapters.read;
  r.adapters.read = async (...args) => {
    const result = await read(...args);
    r.context.isCurrent = () => false;
    return result;
  };
  await assert.rejects(r.run(), { name: "AbortError" });
  assert.equal(r.sent.length, 0);
});

test("disconnect after activation leaves the durable effect and intent for explicit recovery", async () => {
  const f = await setup(),
    r = runner(f),
    send = r.adapters.send;
  r.adapters.send = async (...args) => {
    const result = await send(...args);
    r.context.isCurrent = () => false;
    return result;
  };
  await assert.rejects(r.run(), { name: "AbortError" });
  assert.equal(r.current.service.state, "active");
  assert(r.pending);
  r.context.isCurrent = () => true;
  await r.run();
  assert.equal(r.sent.length, 1);
});

test("all releases are preflighted before the first activation", async () => {
  const f = await setup(),
    r = runner(f);
  f.snapshot.services.releases.push({
    ...f.identity,
    serviceId: "service-" + "f".repeat(64),
  });
  await assert.rejects(r.run(), /unavailable/);
  assert.equal(r.sent.length, 0);
});

test("forged ownership/digests, expired releases and changed revisions fail closed", async () => {
  for (const mutate of [
    (f) => {
      f.snapshot.services.ownerId = "other";
    },
    (f) => {
      f.summary.releases[0].identity.sourceDigest = "a".repeat(64);
    },
    (f) => {
      f.summary.releases[0].state = "missing";
    },
  ]) {
    const f = await setup();
    mutate(f);
    const r = runner(f);
    await assert.rejects(r.run());
    assert.equal(r.sent.length, 0);
  }
  const f = await setup(),
    r = runner(f);
  r.adapters.now = () => f.identity.expiresAt;
  await assert.rejects(r.run(), /expired/);
  const r2 = runner(f);
  r2.adapters.pending = () => ({
    serviceId: f.identity.serviceId,
    control: {
      kind: "activate",
      actionId: "old",
      expectedRevision: 0,
      releaseId: f.identity.resourceId,
    },
  });
  await assert.rejects(r2.run(), /earlier activation/);
  assert.equal(r2.sent.length, 0);
});

test("ordinary exports need no service hosting or publishing endpoint", async () => {
  await api.activateExportServices(
    undefined,
    {},
    { signal: new AbortController().signal, isCurrent: () => true },
  );
});
