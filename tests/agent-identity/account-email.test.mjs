import assert from "node:assert/strict";
import test from "node:test";
import { identityFixture, identityToken, start } from "./helpers.mjs";
import { expectStatus } from "../assistant-task-server/helpers.mjs";

test("identity signup derives the signed-in owner's verified email and private generated name", async () => {
  const f = await identityFixture();
  try {
    const pending = await f.identity("start", start());
    expectStatus(pending, 200);
    const signup = f.api.calls.find((call) => call.path.endsWith("/sign-up"));
    assert.equal(signup.body.human_email, "owner@example.com");
    assert.match(signup.body.username, /^restyle-[a-f0-9]{32}$/);
    assert.equal(
      JSON.stringify(pending.body).includes("owner@example.com"),
      false,
    );
    await f.restart();
    const saved = (await f.identity("list")).body.channels[0];
    const resent = await f.identity(
      "resend",
      { provider: "agentmail", expectedRevision: saved.revision },
      {
        headers: {
          Authorization: `Bearer ${await identityToken({ restyle_email: "new@example.com" })}`,
        },
      },
    );
    expectStatus(resent, 200);
    assert.equal(
      f.api.calls.at(-1).body.human_email,
      "owner@example.com",
      "An already dispatched setup retains its original verified owner contact",
    );
    assert.equal(
      f.api.calls.filter((call) => call.path.endsWith("/sign-up")).length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("signup rejects address substitution, unverified email and another Clerk account before provider dispatch", async () => {
  const f = await identityFixture();
  try {
    for (const fields of [
      { humanEmail: "other@example.com" },
      { name: "chosen-name" },
    ])
      expectStatus(await f.identity("start", { ...start(), ...fields }), 400);
    for (const changes of [
      { restyle_email: undefined },
      { restyle_email: "" },
      { restyle_email_verified: undefined },
      { restyle_email_verified: false },
      { restyle_email_verified: "true" },
    ]) {
      expectStatus(
        await f.identity("start", start(), {
          headers: { Authorization: `Bearer ${await identityToken(changes)}` },
        }),
        412,
      );
    }
    expectStatus(
      await f.identity("start", start(), {
        headers: {
          Authorization: `Bearer ${await identityToken({ sub: "user_someoneelse" })}`,
        },
      }),
      403,
    );
    expectStatus(
      await f.identity("start", start(), {
        headers: { Authorization: "" },
      }),
      401,
    );
    expectStatus(
      await f.identity("start", start(), {
        headers: {
          Authorization: `Bearer ${await identityToken({ restyle_email: "bad-address" })}`,
        },
      }),
      400,
    );
    assert.equal(f.api.calls.length, 0);
    assert.deepEqual((await f.identity("list")).body.channels, []);
  } finally {
    await f.close();
  }
});
