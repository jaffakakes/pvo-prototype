import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture } from "../assistant-task-server/helpers.mjs";
import { controlledEmail } from "../../scripts/checks/restyle-capability/durable-email.mjs";

test("the email journey seeds the real private account and its controlled effects reject scope expansion", async () => {
  const email = controlledEmail();
  const fixture = await taskFixture({
    realClock: true,
    connectionKey: "a".repeat(64),
    connectionFetch: email.connectionFetch,
  });
  try {
    await email.seed(fixture);
    const connections = (
      await fixture.control({ action: "connection-storage" })
    ).body;
    assert.equal(
      connections.find((item) => item.id === "email-sender").credential,
      null,
    );
    const url =
      "https://api.agentmail.to/v0/inboxes/reliability-agent%40agentmail.to/messages/send";
    const headers = {
      Authorization:
        "Bearer am_us_synthetic_reliability_key_never_real_123456789",
      "Idempotency-Key": "same-action",
      "Content-Type": "application/json",
    };
    const body = {
      to: ["friend@example.com"],
      subject: "Thanks",
      text: "Thanks for watching",
    };
    const send = (overrides = {}, destination = url) =>
      email.connectionFetch(
        new Request(destination, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...body, ...overrides }),
        }),
      );
    assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 200);
    assert.equal(email.sends.size, 1);
    await assert.rejects(send({ to: ["another@example.com"] }));
    await assert.rejects(send({}, "https://other.example/messages/send"));
    assert.equal(email.sends.size, 1);
  } finally {
    await fixture.close();
  }
});
