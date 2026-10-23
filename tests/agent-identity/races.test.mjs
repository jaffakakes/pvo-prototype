import assert from "node:assert/strict";
import test from "node:test";
import { identityFixture, start, MAIL_KEY, ADDRESS } from "./helpers.mjs";
import { expectStatus } from "../assistant-task-server/helpers.mjs";
import { parseBuilderDecision } from "../../packages/pvo-assistant/builder/index.js";
import { connectionCommand } from "../../server/connections/input.js";

test("identity bootstrap cannot be forged through ordinary model account setup or the generic key form", () => {
  const setup = { provider: "agentmail", resourceId: ADDRESS };
  assert.throws(
    () =>
      parseBuilderDecision(
        { kind: "connect_account", setup, purpose: "Create accounts" },
        { hasAgreement: false, available: [], connectionSetup: true },
      ),
    /not installed/,
  );
  assert.throws(
    () =>
      connectionCommand("connect", {
        id: "identity-agentmail",
        expectedRevision: 0,
        setup,
        token: MAIL_KEY,
      }),
    /invalid/,
  );
});

test("a concurrent bootstrap dispatches once and resource selection cannot replace a saved identity", async () => {
  const f = await identityFixture();
  let release;
  try {
    const held = new Promise((resolve) => {
      release = resolve;
    });
    f.api.hold = held;
    const first = f.identity("start", start());
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        clearInterval(poll);
        reject(new Error("Bootstrap did not reach provider"));
      }, 3000);
      const poll = setInterval(() => {
        if (f.api.calls.length) {
          clearTimeout(deadline);
          clearInterval(poll);
          resolve();
        }
      }, 5);
    });
    expectStatus(await f.identity("start", start()), 409);
    f.api.hold = null;
    release();
    const pending = await first;
    expectStatus(pending, 200);
    assert.equal(f.api.calls.length, 1);
    const choices = await f.identity("discover", {
      provider: "agentmail",
      expectedRevision: pending.body.revision,
      token: MAIL_KEY,
      consent: true,
    });
    expectStatus(choices, 200);
    assert.deepEqual(choices.body.resources, [
      { resourceId: ADDRESS, address: ADDRESS },
    ]);
    assert.equal(JSON.stringify(choices.body).includes(MAIL_KEY), false);
    expectStatus(
      await f.identity("import", {
        provider: "agentmail",
        expectedRevision: pending.body.revision,
        resourceId: "different-inbox",
        token: MAIL_KEY,
        consent: true,
      }),
      409,
    );
  } finally {
    release?.();
    await f.close();
  }
});

test("one-time phone key is saved before an inspection failure and recovery does not repeat verification", async () => {
  const f = await identityFixture();
  try {
    const pending = await f.identity("start", start("agentphone"));
    f.api.revoked = true;
    const interrupted = await f.identity("verify", {
      provider: "agentphone",
      expectedRevision: pending.body.revision,
      code: "123456",
    });
    assert.equal(interrupted.body.status, "needs_attention");
    assert.ok(
      (await f.control({ action: "identity-storage" })).body[0].private,
    );
    await f.restart();
    f.api.revoked = false;
    const recovered = await f.identity("check", {
      provider: "agentphone",
      expectedRevision: interrupted.body.revision,
    });
    assert.equal(recovered.body.status, "ready");
    assert.equal(
      f.api.calls.filter((call) => call.path.endsWith("/verify")).length,
      1,
    );
    assert.equal(
      (await f.control({ action: "identity-storage" })).body[0].private,
      null,
    );
  } finally {
    await f.close();
  }
});

test("a temporary provider failure recovers with the already saved key, without another signup or private import", async () => {
  const f = await identityFixture();
  try {
    const pending = await f.identity("start", start());
    const ready = await f.identity("verify", {
      provider: "agentmail",
      expectedRevision: pending.body.revision,
      code: "123456",
    });
    f.api.unavailable = true;
    const failed = await f.identity("check", {
      provider: "agentmail",
      expectedRevision: ready.body.revision,
    });
    assert.equal(failed.body.status, "needs_attention");
    assert.ok(
      (await f.control({ action: "connection-storage" })).body[0].credential,
    );
    await f.restart();
    f.api.unavailable = false;
    const recovered = await f.identity("check", {
      provider: "agentmail",
      expectedRevision: failed.body.revision,
    });
    expectStatus(recovered, 200);
    assert.equal(recovered.body.status, "ready");
    assert.equal(
      f.api.calls.filter((call) => call.path.endsWith("/sign-up")).length,
      1,
    );
    assert.equal(
      f.api.calls.filter((call) => call.path.endsWith("/verify")).length,
      1,
    );
  } finally {
    await f.close();
  }
});
