import assert from "node:assert/strict";
import test from "node:test";
import { identityFixture, MAIL_KEY, ADDRESS } from "./helpers.mjs";
import { expectStatus, NOW } from "../assistant-task-server/helpers.mjs";
import { emailFixture, emailInput } from "../service-jobs/email.fixture.mjs";
import { agentMailAdapter } from "../../server/connections/providers/agentMail.js";
import {
  parseConnectionAdapter,
  parseConnectionSetup,
} from "../../packages/pvo-assistant/connections/index.js";

const setup = { provider: "agentmail", recipient: "friend@example.com" };
const adapter = {
  ...emailFixture().agreement.connections[0].adapter,
  provider: "agentmail",
  path: ["messages", "send"],
  result: {
    type: "object",
    fields: [
      {
        name: "id",
        description: "Provider receipt",
        schema: { type: "string", maxBytes: 512 },
      },
    ],
  },
  documentation: "https://docs.agentmail.to/idempotency",
};
const invoke = (actionId = "send-one") => ({
  kind: "service_invoke",
  input: {
    serviceId: `service-${"a".repeat(64)}`,
    actionId,
    index: 0,
    connectionId: "sender-one",
    adapter,
    input: structuredClone(emailInput),
  },
});
async function fixture() {
  const f = await identityFixture();
  return {
    ...f,
    command: (operation) =>
      f.control({ action: "connection-command", operation }),
    connect: () =>
      f.request("/api/account-connections/connect", {
        headers: { "X-Restyle-Owner": f.owner },
        body: { id: "sender-one", expectedRevision: 0, setup, token: "" },
      }),
    ready: () =>
      f.identity("import", {
        provider: "agentmail",
        expectedRevision: 0,
        resourceId: ADDRESS,
        token: MAIL_KEY,
        consent: true,
      }),
  };
}
test("agent email requires a ready identity and recipient approval; lost-response recovery survives restart without a second send", async () => {
  const f = await fixture();
  try {
    expectStatus(await f.connect(), 409);
    expectStatus(await f.ready(), 200);
    const connected = await f.connect();
    expectStatus(connected, 200);
    assert.deepEqual(connected.body.connection.operations, [
      { id: "agentmail_email_send", permissions: ["email:send"] },
    ]);
    const rows = (await f.control({ action: "connection-storage" })).body;
    assert.equal(rows.find((r) => r.id === "sender-one").credential, null);
    assert(!JSON.stringify(rows).includes(MAIL_KEY));
    f.api.loseSend = true;
    expectStatus(await f.command(invoke()), 409);
    assert.equal(f.api.sent.size, 1);
    await f.restart();
    const recovered = await f.command(invoke());
    expectStatus(recovered, 200);
    assert.equal(recovered.body.value.result.id, "<message-one@agentmail.to>");
    expectStatus(await f.command(invoke()), 200);
    assert.equal(f.api.sent.size, 1);
    const sent = f.api.calls.filter((c) => c.path.endsWith("/messages/send"));
    assert.equal(sent.length, 2);
    assert.equal(sent[0].idempotencyKey, sent[1].idempotencyKey);
    assert.deepEqual(sent[0].body, { to: [setup.recipient], ...emailInput });
    assert.equal(
      sent[0].path,
      `/v0/inboxes/${encodeURIComponent(ADDRESS)}/messages/send`,
    );
    const forged = invoke("forged");
    forged.input.input.to = ["other@example.com"];
    expectStatus(await f.command(forged), 503);
    assert.equal(f.api.sent.size, 1);
    const ready = (await f.identity("list")).body.channels[0];
    expectStatus(
      await f.identity("disconnect", {
        provider: "agentmail",
        expectedRevision: ready.revision,
      }),
      200,
    );
    expectStatus(await f.command(invoke("after-disconnect")), 409);
    assert.equal(f.api.sent.size, 1);
  } finally {
    await f.close();
  }
});
test("agent email adapter rejects scope expansion and stops uncertain retries before the provider retention window", async () => {
  for (const documentation of [
    "https://docs.agentmail.to/api-reference/inboxes/messages/send",
    "https://www.agentmail.to/docs/api-reference/inboxes/messages/send",
  ])
    assert.equal(
      parseConnectionAdapter({ ...adapter, documentation }).documentation,
      documentation,
    );
  for (const extra of [
    { url: "https://other.example" },
    { resourceId: "other" },
    { from: "other@example.com" },
  ])
    assert.throws(() => parseConnectionSetup({ ...setup, ...extra }));
  for (const change of [
    { path: ["messages"] },
    { method: "GET" },
    { permission: "identity:receive" },
    { documentation: "https://evil.example/docs" },
    { documentation: "https://www.agentmail.to/blog/send" },
    { documentation: "https://www.agentmail.to.evil.example/docs/send" },
    { documentation: "https://www.agentmail.to@evil.example/docs/send" },
    { documentation: "https://www.agentmail.to/docs-evil/send" },
  ])
    assert.throws(() => parseConnectionAdapter({ ...adapter, ...change }));
  let calls = 0;
  const provider = agentMailAdapter(async () => {
    calls++;
    return Response.json({ message_id: "<receipt@agentmail.to>" });
  });
  const credential = JSON.stringify({ key: MAIL_KEY, inboxId: ADDRESS });
  assert.equal(
    await provider.service.inspect(
      setup,
      credential,
      adapter,
      emailInput,
      "b".repeat(64),
      "sender",
      { createdAt: NOW, now: NOW + 23 * 3600000 },
    ),
    null,
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await provider.service.invoke(
      setup,
      credential,
      adapter,
      emailInput,
      "b".repeat(64),
    ),
    { id: "<receipt@agentmail.to>" },
  );
  assert.equal(calls, 1);
});

test("identity disconnect during sending fences the late result; an uncertain send never moves to a replacement key", async () => {
  const f = await fixture();
  try {
    expectStatus(await f.ready(), 200);
    const connected = await f.connect();
    expectStatus(connected, 200);
    assert.deepEqual(connected.body.connection.operations, [
      { id: "agentmail_email_send", permissions: ["email:send"] },
    ]);
    f.api.loseSend = true;
    expectStatus(await f.command(invoke()), 409);
    const first = (await f.identity("list")).body.channels[0];
    const disconnected = await f.identity("disconnect", {
      provider: "agentmail",
      expectedRevision: first.revision,
    });
    expectStatus(disconnected, 200);
    // Expire the derived approval before replacing the identity's credential.
    expectStatus(await f.command(invoke()), 409);
    expectStatus(
      await f.identity("import", {
        provider: "agentmail",
        expectedRevision: disconnected.body.revision,
        resourceId: ADDRESS,
        token: MAIL_KEY + "replacement",
        consent: true,
      }),
      200,
    );
    expectStatus(
      await f.request("/api/account-connections/connect", {
        headers: { "X-Restyle-Owner": f.owner },
        body: { id: "sender-one", expectedRevision: 2, setup, token: "" },
      }),
      200,
    );
    const before = f.api.calls.filter((c) =>
      c.path.endsWith("/messages/send"),
    ).length;
    expectStatus(await f.command(invoke()), 409);
    assert.equal(
      f.api.calls.filter((c) => c.path.endsWith("/messages/send")).length,
      before,
    );
    let release;
    f.api.hold = new Promise((resolve) => {
      release = resolve;
    });
    const pending = f.command(invoke("late-send"));
    // Wait for the controlled provider to receive this exact new action.
    const deadline = Date.now() + 3000;
    while (
      f.api.calls.filter((c) => c.path.endsWith("/messages/send")).length ===
        before &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert(
      f.api.calls.filter((c) => c.path.endsWith("/messages/send")).length >
        before,
    );
    const current = (await f.identity("list")).body.channels[0];
    expectStatus(
      await f.identity("disconnect", {
        provider: "agentmail",
        expectedRevision: current.revision,
      }),
      200,
    );
    release();
    f.api.hold = null;
    expectStatus(await pending, 409);
    expectStatus(await f.command(invoke("after-late-disconnect")), 409);
    assert.equal(f.api.sent.size, 2);
  } finally {
    await f.close();
  }
});
