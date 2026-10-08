import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { resendAdapter } from "../../server/connections/providers/resend.js";
import { verifyResendWebhook } from "../../server/connections/providers/resendWebhook.js";
import {
  applyProviderUpdate,
  mergeProviderReceipts,
} from "../../packages/pvo-assistant/jobs/provider.js";
import {
  emailFixture,
  emailSetup,
  EMAIL_KEY,
  WEBHOOK_SECRET,
  emailInput,
} from "./email.fixture.mjs";
const token = JSON.stringify({ key: EMAIL_KEY, webhookSecret: WEBHOOK_SECRET });

test("Resend transport rejects redirects, reflected keys, oversized results and hung fetch/body promises", async () => {
  for (const fetcher of [
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://bad.example" },
      }),
    async () => Response.json({ token: EMAIL_KEY }),
    async () => Response.json({ data: "x".repeat(65537) }),
    () => new Promise(() => {}),
    async () =>
      new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  ]) {
    await assert.rejects(
      resendAdapter(fetcher, 30).verify(emailSetup, token),
      (error) => error.status === 503 && !error.message.includes(EMAIL_KEY),
    );
  }
});

test("uncertain email reconciliation stops before the provider's 24-hour idempotency expiry", async () => {
  let sends = 0;
  const provider = resendAdapter(async () => {
    sends++;
    return Response.json({ id: "12345678-1234-1234-1234-123456789012" });
  });
  const adapter = emailFixture().agreement.connections[0].adapter;
  assert.equal(
    await provider.service.inspect(
      emailSetup,
      token,
      adapter,
      emailInput,
      "a".repeat(64),
      "sender",
      { createdAt: 1, now: 23 * 3600000 + 1 },
    ),
    null,
  );
  assert.equal(sends, 0);
  await provider.service.inspect(
    emailSetup,
    token,
    adapter,
    emailInput,
    "a".repeat(64),
    "sender",
    { createdAt: 1, now: 2 },
  );
  assert.equal(sends, 1);
});

test("webhook signature binds exact bytes, rejects old/future timestamps, and supports signing-key rotation", async () => {
  const now = Date.UTC(2026, 9, 8),
    timestamp = String(now / 1000),
    id = "msg_signature";
  const body = JSON.stringify({
    type: "email.delivered",
    created_at: new Date(now).toISOString(),
    data: { email_id: "12345678-1234-1234-1234-123456789012" },
  });
  const sign = (time) =>
    createHmac("sha256", Buffer.from(WEBHOOK_SECRET.slice(6), "base64"))
      .update(`${id}.${time}.${body}`)
      .digest("base64");
  const headers = { id, timestamp, signature: `v1,AAAA v1,${sign(timestamp)}` };
  assert.equal(
    (await verifyResendWebhook(WEBHOOK_SECRET, body, headers, now)).event,
    "delivered",
  );
  await assert.rejects(
    verifyResendWebhook(WEBHOOK_SECRET, body + " ", headers, now),
    { status: 401 },
  );
  for (const offset of [-301, 301]) {
    const time = String(now / 1000 + offset);
    await assert.rejects(
      verifyResendWebhook(
        WEBHOOK_SECRET,
        body,
        { ...headers, timestamp: time, signature: `v1,${sign(time)}` },
        now,
      ),
      { status: 401 },
    );
  }
});

test("a stale polling result cannot overwrite delivery recorded by a concurrent callback", () => {
  const receipt = {
    connectionId: "connection-one",
    index: 0,
    provider: "resend",
    id: "12345678-1234-1234-1234-123456789012",
    state: "delivered",
    updatedAt: 3,
  };
  const merged = mergeProviderReceipts(
    [receipt],
    [{ ...receipt, state: "accepted", updatedAt: 4 }],
  );
  assert.equal(merged[0].state, "delivered");
  const job = {
    status: "pending",
    executionDone: true,
    result: "accepted",
    providerReceipts: merged,
  };
  assert.equal(
    applyProviderUpdate(job, receipt.connectionId, receipt.id, "sent", 5, 5)
      .status,
    "confirmed",
  );
});
