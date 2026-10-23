import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { fixture } from "../account-connections/helpers.mjs";
import {
  hosted,
  control,
  call,
  expectStatus,
} from "../service-actions/helpers.mjs";
import { NOW } from "../assistant-task-server/helpers.mjs";
import {
  emailFixture,
  emailProvider,
  emailConnect,
  emailInput,
  EMAIL_ID,
  WEBHOOK_SECRET,
} from "./email.fixture.mjs";
const key = "e".repeat(64);
const path = (service) => `/api/services/${service.identity.serviceId}`;
const submit = (f, service, actionId = "email-one") =>
  f.request(path(service) + "/jobs", {
    session: null,
    body: {
      releaseId: service.identity.resourceId,
      action: { actionId, operation: "lookup", input: emailInput },
      receiptKey: key,
      schedule: null,
    },
  });
const receipt = (f, service) =>
  f.request(path(service) + "/job-receipt", {
    session: null,
    body: { actionId: "email-one", receiptKey: key },
  });
const run = (f, service) =>
  f.control({
    action: "host-diagnostic",
    identity: service.identity,
    kind: "sweep",
  });
const access = (f, service) =>
  f.request(path(service) + "/account-access", {
    body: { kind: "approve", releaseId: service.identity.resourceId },
  });

test(
  "email jobs separate sender acceptance from delivery, ordinary Try never sends, and polling checks only the owned receipt",
  { timeout: 30000 },
  async () => {
    const api = emailProvider(),
      f = await fixture({ services: true, connectionFetch: api.fetch });
    try {
      expectStatus(await f.connection("connect", emailConnect()), 200);
      const service = await hosted(f, emailFixture());
      expectStatus(
        await call(f, service, {
          actionId: "trial",
          operation: "lookup",
          input: emailInput,
        }),
        200,
      );
      assert.equal(api.sends, 0);
      expectStatus(await access(f, service), 200);
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(await submit(f, service), 202);
      await run(f, service);
      const accepted = await receipt(f, service);
      assert.equal(accepted.body.job.status, "pending");
      assert.match(accepted.body.job.label, /accepted by sender/);
      assert.equal(api.sends, 1);
      expectStatus(
        await f.request(path(service) + "/job-control", {
          body: { actionId: "email-one", kind: "cancel" },
        }),
        409,
      );
      await f.restart();
      api.event = "delivered";
      await f.control({ action: "time", now: NOW + 60001 });
      await run(f, service);
      assert.equal((await receipt(f, service)).body.job.status, "confirmed");
      assert.match((await receipt(f, service)).body.job.label, /mail server/);
      assert.equal(api.sends, 1);
      const completed = (await f.request(path(service) + "/jobs")).body.jobs[0];
      assert.equal(completed.providerReceipts[0].id, EMAIL_ID);
    } finally {
      await f.close();
    }
  },
);

test(
  "a provider timeout after acceptance is reconciled with the same idempotency key after restart and never sends twice",
  { timeout: 30000 },
  async () => {
    const api = emailProvider(),
      f = await fixture({ services: true, connectionFetch: api.fetch });
    try {
      expectStatus(await f.connection("connect", emailConnect()), 200);
      const service = await hosted(f, emailFixture());
      expectStatus(await access(f, service), 200);
      expectStatus(await control(f, service, "activate"), 200);
      api.lost = true;
      expectStatus(await submit(f, service), 202);
      await run(f, service);
      assert.equal(
        (await receipt(f, service)).body.job.status,
        "needs_checking",
      );
      await f.restart();
      expectStatus(
        await f.request(path(service) + "/job-control", {
          body: { actionId: "email-one", kind: "resume" },
        }),
        200,
      );
      await run(f, service);
      assert.equal((await receipt(f, service)).body.job.status, "pending");
      assert.equal(api.sends, 1);
      assert.equal(api.accepted.size, 1);
    } finally {
      await f.close();
    }
  },
);

test(
  "verified provider callbacks match existing jobs, deduplicate events and reject invalid, old and reordered updates",
  { timeout: 30000 },
  async () => {
    const api = emailProvider(),
      f = await fixture({ services: true, connectionFetch: api.fetch });
    try {
      expectStatus(await f.connection("connect", emailConnect()), 200);
      const service = await hosted(f, emailFixture());
      expectStatus(await access(f, service), 200);
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(await submit(f, service), 202);
      await run(f, service);
      const callback = async (
        eventId,
        type,
        { emailId = EMAIL_ID, invalid = false, at = NOW } = {},
      ) => {
        const body = JSON.stringify({
          type,
          created_at: new Date(at).toISOString(),
          data: { email_id: emailId },
        });
        const timestamp = String(Math.floor(NOW / 1000));
        const signature = createHmac(
          "sha256",
          Buffer.from(WEBHOOK_SECRET.slice(6), "base64"),
        )
          .update(`${eventId}.${timestamp}.${body}`)
          .digest("base64");
        return f.request(path(service) + "/resend/connection-one", {
          method: "POST",
          body: JSON.parse(body),
          session: null,
          headers: {
            "svix-id": eventId,
            "svix-timestamp": timestamp,
            "svix-signature": `v1,${invalid ? "AAAA" : signature}`,
          },
        });
      };
      assert.notEqual(
        (await callback("msg_bad", "email.delivered", { invalid: true }))
          .status,
        200,
      );
      assert.equal((await receipt(f, service)).body.job.status, "pending");
      assert.deepEqual(
        (
          await callback("msg_unknown", "email.delivered", {
            emailId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          })
        ).body,
        { recorded: false },
      );
      expectStatus(await callback("msg_delivered", "email.delivered"), 200);
      expectStatus(await callback("msg_delivered", "email.delivered"), 200);
      expectStatus(
        await callback("msg_late_sent", "email.sent", { at: NOW - 1000 }),
        200,
      );
      assert.equal((await receipt(f, service)).body.job.status, "confirmed");
      await f.restart();
      expectStatus(await callback("msg_delivered", "email.delivered"), 200);
      assert.equal(api.sends, 1);
    } finally {
      await f.close();
    }
  },
);

test(
  "offline sender and expired credentials keep an accurate unfinished action; reconnect safely checks the same action",
  { timeout: 30000 },
  async () => {
    const api = emailProvider(),
      f = await fixture({ services: true, connectionFetch: api.fetch });
    try {
      expectStatus(await f.connection("connect", emailConnect()), 200);
      const service = await hosted(f, emailFixture());
      expectStatus(await access(f, service), 200);
      expectStatus(await control(f, service, "activate"), 200);
      api.offline = true;
      expectStatus(await submit(f, service), 202);
      await run(f, service);
      assert.equal(
        (await receipt(f, service)).body.job.status,
        "needs_checking",
      );
      assert.equal(api.sends, 0);
      api.offline = false;
      api.reject = true;
      expectStatus(
        await f.request(path(service) + "/job-control", {
          body: { actionId: "email-one", kind: "resume" },
        }),
        200,
      );
      await run(f, service);
      assert.equal(
        (await receipt(f, service)).body.job.status,
        "needs_checking",
      );
      const connection = (await f.list()).body.items[0].connection;
      assert.equal(connection.status, "expired");
      api.reject = false;
      expectStatus(
        await f.connection("connect", {
          ...emailConnect(),
          expectedRevision: connection.revision,
        }),
        200,
      );
      await f.restart();
      expectStatus(
        await f.request(path(service) + "/job-control", {
          body: { actionId: "email-one", kind: "resume" },
        }),
        200,
      );
      await run(f, service);
      assert.equal((await receipt(f, service)).body.job.status, "pending");
      assert.equal(api.sends, 1);
    } finally {
      await f.close();
    }
  },
);

test(
  "changing the sender key cannot repeat an uncertain write under a different provider identity",
  { timeout: 30000 },
  async () => {
    const api = emailProvider(),
      f = await fixture({ services: true, connectionFetch: api.fetch });
    try {
      expectStatus(await f.connection("connect", emailConnect()), 200);
      const service = await hosted(f, emailFixture());
      expectStatus(await access(f, service), 200);
      expectStatus(await control(f, service, "activate"), 200);
      api.lost = true;
      expectStatus(await submit(f, service), 202);
      await run(f, service);
      assert.equal(api.sends, 1);
      const connection = (await f.list()).body.items[0].connection,
        input = emailConnect();
      const token = JSON.parse(input.token);
      token.key += "rotated";
      expectStatus(
        await f.connection("connect", {
          ...input,
          token: JSON.stringify(token),
          expectedRevision: connection.revision,
        }),
        200,
      );
      const posts = api.calls.filter((call) => call.method === "POST").length;
      expectStatus(
        await f.request(path(service) + "/job-control", {
          body: { actionId: "email-one", kind: "resume" },
        }),
        200,
      );
      await run(f, service);
      assert.equal(
        (await receipt(f, service)).body.job.status,
        "needs_checking",
      );
      assert.equal(
        api.calls.filter((call) => call.method === "POST").length,
        posts,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "delivery checks stop after twelve attempts without claiming delivery or sending again",
  { timeout: 30000 },
  async () => {
    const api = emailProvider(),
      f = await fixture({ services: true, connectionFetch: api.fetch });
    try {
      expectStatus(await f.connection("connect", emailConnect()), 200);
      const service = await hosted(f, emailFixture());
      expectStatus(await access(f, service), 200);
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(await submit(f, service), 202);
      await run(f, service);
      for (let i = 1; i <= 12; i++) {
        await f.control({ action: "time", now: NOW + i * 3600000 });
        await run(f, service);
      }
      assert.equal(
        (await receipt(f, service)).body.job.status,
        "needs_checking",
      );
      const job = (await f.request(path(service) + "/jobs")).body.jobs[0];
      assert.equal(job.polls, 12);
      const reads = api.calls.filter(
        (call) => call.path === `/emails/${EMAIL_ID}`,
      ).length;
      assert.equal(reads, 12);
      await f.control({ action: "time", now: NOW + 13 * 3600000 });
      await run(f, service);
      assert.equal(
        api.calls.filter((call) => call.path === `/emails/${EMAIL_ID}`).length,
        reads,
      );
      assert.equal(api.sends, 1);
    } finally {
      await f.close();
    }
  },
);
