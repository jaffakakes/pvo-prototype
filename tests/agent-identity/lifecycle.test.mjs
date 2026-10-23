import assert from "node:assert/strict";
import test from "node:test";
import {
  identityFixture,
  start,
  MAIL_KEY,
  PHONE_KEY,
  ADDRESS,
} from "./helpers.mjs";
import { expectStatus } from "../assistant-task-server/helpers.mjs";

test("email signup, one-time key capture, restart, verification and the existing vault persist one identity", async () => {
  const f = await identityFixture();
  try {
    const pending = await f.identity("start", start());
    expectStatus(pending, 200);
    assert.equal(pending.body.status, "awaiting_verification");
    assert.equal(JSON.stringify(pending.body).includes(MAIL_KEY), false);
    const privateRows = (await f.control({ action: "identity-storage" })).body;
    assert.equal(privateRows.length, 1);
    assert.ok(privateRows[0].private);
    assert.equal(JSON.stringify(privateRows).includes(MAIL_KEY), false);
    assert.equal(
      JSON.stringify(privateRows).includes("owner@example.com"),
      false,
    );
    await f.restart();
    const saved = (await f.identity("list")).body.channels[0];
    assert.equal(saved.revision, pending.body.revision);
    const resent = await f.identity("resend", {
      provider: "agentmail",
      expectedRevision: saved.revision,
    });
    expectStatus(resent, 200);
    assert.equal(resent.body.status, "awaiting_verification");
    const ready = await f.identity("verify", {
      provider: "agentmail",
      expectedRevision: resent.body.revision,
      code: "123456",
    });
    expectStatus(ready, 200);
    assert.equal(ready.body.status, "ready");
    assert.equal(ready.body.address, ADDRESS);
    assert.equal(JSON.stringify(ready.body).includes(MAIL_KEY), false);
    const connections = (await f.control({ action: "connection-storage" }))
      .body;
    assert.equal(connections.length, 1);
    assert.equal(JSON.stringify(connections).includes(MAIL_KEY), false);
    assert.equal(
      (await f.control({ action: "identity-storage" })).body[0].private,
      null,
    );
    await f.restart();
    assert.equal(
      (await f.identity("list")).body.channels[0].connectionId,
      "identity-agentmail",
    );
    expectStatus(
      await f.identity("start", {
        ...start(),
        expectedRevision: ready.body.revision,
      }),
      409,
    );
    assert.equal(
      f.api.calls.filter((x) => x.path.endsWith("/sign-up")).length,
      1,
    );
    const disconnected = await f.identity("disconnect", {
      provider: "agentmail",
      expectedRevision: ready.body.revision,
    });
    expectStatus(disconnected, 200);
    assert.equal(disconnected.body.status, "disconnected");
    assert.equal(
      (await f.control({ action: "connection-storage" })).body[0].credential,
      null,
    );
    const restored = await f.identity("import", {
      provider: "agentmail",
      expectedRevision: disconnected.body.revision,
      resourceId: ADDRESS,
      token: MAIL_KEY,
      consent: true,
    });
    expectStatus(restored, 200);
    assert.equal(restored.body.status, "ready");
  } finally {
    await f.close();
  }
});

test("phone signup requires number-cost consent and never creates another account after an uncertain verification", async () => {
  const f = await identityFixture();
  try {
    expectStatus(
      await f.identity("start", {
        ...start("agentphone"),
        monthlyNumberCents: 0,
      }),
      400,
    );
    assert.equal(f.api.calls.length, 0);
    const pending = await f.identity("start", start("agentphone"));
    expectStatus(pending, 200);
    f.api.lostVerify = true;
    const uncertain = await f.identity("verify", {
      provider: "agentphone",
      expectedRevision: pending.body.revision,
      code: "123456",
    });
    expectStatus(uncertain, 200);
    assert.equal(uncertain.body.status, "needs_attention");
    await f.restart();
    const checked = await f.identity("check", {
      provider: "agentphone",
      expectedRevision: uncertain.body.revision,
    });
    expectStatus(checked, 200);
    expectStatus(
      await f.identity("verify", {
        provider: "agentphone",
        expectedRevision: checked.body.revision,
        code: "123456",
      }),
      409,
    );
    assert.equal(
      f.api.calls.filter((x) => x.path.endsWith("/verify")).length,
      1,
    );
    f.api.lostVerify = false;
    const recovered = await f.identity("import", {
      provider: "agentphone",
      expectedRevision: checked.body.revision,
      resourceId: "number-one",
      token: PHONE_KEY,
      consent: true,
    });
    expectStatus(recovered, 200);
    assert.equal(recovered.body.status, "ready");
    assert.equal(recovered.body.address, "+14155550123");
  } finally {
    await f.close();
  }
});

test("bad human code keeps the saved pending identity and provider access rejection erases the usable key", async () => {
  const f = await identityFixture();
  try {
    const pending = await f.identity("start", start());
    f.api.failVerify = true;
    const rejected = await f.identity("verify", {
      provider: "agentmail",
      expectedRevision: pending.body.revision,
      code: "123456",
    });
    assert.equal(rejected.body.status, "awaiting_verification");
    f.api.failVerify = false;
    const ready = await f.identity("verify", {
      provider: "agentmail",
      expectedRevision: rejected.body.revision,
      code: "123456",
    });
    assert.equal(ready.body.status, "ready");
    f.api.revoked = true;
    const rejectedAccess = await f.identity("check", {
      provider: "agentmail",
      expectedRevision: ready.body.revision,
    });
    assert.equal(rejectedAccess.body.status, "needs_attention");
    assert.equal(
      (await f.control({ action: "connection-storage" })).body[0].credential,
      null,
    );
  } finally {
    await f.close();
  }
});

test("owner, origin, stale revision and concurrent setup fences protect private bootstrap", async () => {
  const f = await identityFixture();
  try {
    expectStatus(await f.identity("start", start(), { session: null }), 401);
    expectStatus(
      await f.identity("start", start(), {
        headers: { Origin: "https://other.example" },
      }),
      403,
    );
    expectStatus(
      await f.identity("start", start(), { session: f.otherCookie }),
      403,
    );
    expectStatus(
      await f.identity("start", { ...start(), token: MAIL_KEY }),
      400,
    );
    const pending = await f.identity("start", start());
    expectStatus(await f.identity("start", start()), 409);
    assert.equal(
      f.api.calls.filter((x) => x.path.endsWith("/sign-up")).length,
      1,
    );
    expectStatus(
      await f.identity("verify", {
        provider: "agentmail",
        expectedRevision: 0,
        code: "123456",
      }),
      409,
    );
    const otherOwner = (
      await f.request("/api/auth/session", { session: f.otherCookie })
    ).body.user.id;
    const otherList = await f.identity("list", null, {
      session: f.otherCookie,
      headers: { "X-Restyle-Owner": otherOwner },
    });
    assert.deepEqual(otherList.body.channels, []);
    assert.equal(pending.body.status, "awaiting_verification");
  } finally {
    await f.close();
  }
});
