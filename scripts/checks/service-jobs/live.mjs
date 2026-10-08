import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import { homedir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fixture as accountFixture } from "../../../tests/account-connections/helpers.mjs";
import {
  hosted,
  control,
  call,
  expectStatus,
  inspect,
} from "../../../tests/service-actions/helpers.mjs";
import { checkedAcceptance } from "../../../tests/service-jobs/acceptance.fixture.mjs";
import {
  emailInput,
  emailProvider,
  EMAIL_KEY,
  emailSetup,
} from "../../../tests/service-jobs/email.fixture.mjs";

// Explicit real-email diagnostic. No cloud deployment, model call or account purchase.
const privatePath = homedir() + "/.codex/secure/restyle-3/resend.json";
const controlled = process.argv.includes("--controlled");
const provider = controlled ? emailProvider() : null;
if (provider) provider.event = "delivered";
const reportPath =
  homedir() +
  `/.codex/backups/restyle-3-${controlled ? "controlled" : "live"}.json`;
await mkdir(homedir() + "/.codex/backups", { recursive: true, mode: 0o700 });
const report = {
  startedAt: new Date().toISOString(),
  status: "preparing",
  proof: controlled ? "controlled provider; no real email" : "real Resend",
  plannedResources: [
    "One disposable local Worker/SQLite fixture with encrypted Resend connection",
    controlled
      ? "One controlled email identity, no real provider calls"
      : "One real email to the creator-approved address; at most three allowed by private consent",
  ],
  cloudResources: [],
  realProviderPosts: 0,
  providerPosts: 0,
  providerId: null,
  checks: [],
  storagePath: null,
  cleanup: {
    connectionDisconnected: false,
    fixtureRemoved: false,
    privateInputRemoved: false,
    providerKeyRevoked: false,
  },
};
const save = () =>
  writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
let setup;
try {
  setup = controlled
    ? {
        key: EMAIL_KEY,
        from: emailSetup.from,
        to: emailSetup.recipient,
        maxMessages: 3,
        consentAt: new Date().toISOString(),
        content: emailInput.text,
      }
    : JSON.parse(await readFile(privatePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT")
    throw new Error("The private setup file is invalid; no send attempted.");
  report.status = "waiting_for_private_setup";
  await save();
  console.log(
    "Waiting for the private Resend form to show Resend connected; no email sent.",
  );
  process.exit(0);
}
assert.equal(setup.maxMessages, 3);
assert.equal(setup.content, emailInput.text);
assert.ok(
  Date.parse(setup.consentAt) > Date.now() - 86400000,
  "Private consent must be from the last day.",
);
assert.ok(/^re_[A-Za-z0-9_-]{20,1000}$/.test(setup.key));
assert.ok(
  [setup.from, setup.to].every(
    (value) =>
      typeof value === "string" &&
      /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value),
  ),
);
report.recipientDigest = createHash("sha256").update(setup.to).digest("hex");
await save();
let fixture,
  service,
  lost = false;
const identities = new Set();
const connectionFetch = async (request) => {
  const url = new URL(request.url);
  assert.equal(url.origin, "https://api.resend.com");
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body) {
    const value = JSON.parse(body);
    assert.deepEqual(value, {
      from: setup.from,
      to: [setup.to],
      subject: emailInput.subject,
      text: setup.content,
    });
    const key = request.headers.get("Idempotency-Key");
    assert.match(key, /^[a-f0-9]{64}$/);
    identities.add(key);
    assert.ok(
      identities.size <= 1,
      "Only one real email identity is allowed by this diagnostic.",
    );
    report.providerPosts++;
    if (!controlled) report.realProviderPosts++;
    assert.ok(report.providerPosts <= 3, "Bound provider calls.");
    await save();
  } else
    assert.ok(
      url.pathname === "/emails" ||
        url.pathname === `/emails/${report.providerId}`,
    );
  const response = provider
    ? await provider.fetch(
        new Request(url, {
          method: request.method,
          headers: request.headers,
          ...(body ? { body } : {}),
        }),
      )
    : await fetch(url, {
        method: request.method,
        headers: request.headers,
        ...(body ? { body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(12000),
      });
  const bytes = await response.arrayBuffer();
  if (body && response.ok && !lost) {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    assert.match(value.id, /^[a-f0-9-]{36}$/);
    report.providerId = value.id;
    lost = true;
    await save();
    // The provider accepted this real message. Deliberately lose its reply inside the diagnostic adapter.
    return Response.json({}, { status: 503 });
  }
  return new Response(bytes, {
    status: response.status,
    headers: response.headers,
  });
};
try {
  const checked = await checkedAcceptance();
  report.checks.push(
    "Independent expected cases executed in local Node; duplicate acceptance/capacity do not request email",
  );
  fixture = await accountFixture({
    services: true,
    realClock: true,
    clock: null,
    connectionKey: randomBytes(32).toString("hex"),
    connectionFetch,
  });
  report.storagePath = fixture.storagePath;
  report.status = "connecting";
  await save();
  expectStatus(
    await fixture.connection("connect", {
      id: "connection-one",
      expectedRevision: 0,
      setup: { provider: "resend", from: setup.from, recipient: setup.to },
      token: JSON.stringify({ key: setup.key, webhookSecret: "" }),
    }),
    200,
  );
  service = await hosted(fixture, { checked });
  report.serviceId = service.identity.serviceId;
  report.releaseId = service.identity.resourceId;
  await save();
  const path = `/api/services/${service.identity.serviceId}`;
  expectStatus(
    await call(fixture, service, {
      actionId: "offline-try",
      operation: "accept",
      input: { name: "Test guest" },
    }),
    200,
  );
  assert.equal(report.realProviderPosts, 0);
  report.checks.push(
    "Ordinary Try executes checked examples with zero real sends",
  );
  expectStatus(
    await fixture.request(path + "/account-access", {
      body: { kind: "approve", releaseId: service.identity.resourceId },
    }),
    200,
  );
  expectStatus(await control(fixture, service, "activate"), 200);
  const receiptKey = randomBytes(32).toString("hex");
  const input = {
    releaseId: service.identity.resourceId,
    action: {
      actionId: "real-acceptance",
      operation: "accept",
      input: { name: "Approved test guest" },
    },
    receiptKey,
    schedule: { at: Date.now() + 1500, timezone: "Europe/London" },
  };
  const read = () =>
    fixture.request(path + "/job-receipt", {
      session: null,
      body: { actionId: input.action.actionId, receiptKey },
    });
  const waitFor = async (states, timeoutMs, requireResult = false) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      expectStatus(value, 200);
      report.lastJob = value.body.job;
      if (
        states.includes(value.body.job.status) &&
        (!requireResult || value.body.job.result !== null)
      )
        return value.body;
      if (Date.now() > deadline)
        throw new Error(
          "The saved job did not reach the expected state before the diagnostic deadline.",
        );
      await delay(250);
    }
  };
  expectStatus(
    await fixture.request(path + "/jobs", { session: null, body: input }),
    202,
  );
  await fixture.restart();
  report.status = "reconciling_original_action";
  await save();
  report.status = "waiting_for_durable_alarm_without_viewers";
  await save();
  // There is no browser and no manual sweep: the restarted worker's durable alarm owns execution.
  await waitFor(["needs_checking"], 30000);
  assert.ok(lost && report.providerId);
  report.checks.push(
    `${controlled ? "Controlled sender" : "Real provider"} accepted one message with every viewer closed; lost reply retained an uncertain action`,
  );
  await fixture.restart();
  expectStatus(
    await fixture.request(path + "/job-control", {
      body: { actionId: input.action.actionId, kind: "resume" },
    }),
    200,
  );
  const pending = await waitFor(["pending", "confirmed"], 30000, true);
  assert.equal(pending.job.result, "accepted");
  assert.equal(identities.size, 1);
  report.checks.push(
    "Restart and creator resume reconciled the same provider idempotency key and recorded the acceptance",
  );
  const state = (await inspect(fixture, service)).data.find(
    (row) => row.namespace === "live",
  );
  assert.deepEqual(JSON.parse(state.body).guests, ["Approved test guest"]);
  expectStatus(
    await fixture.request(path + "/jobs", { session: null, body: input }),
    202,
  );
  expectStatus(
    await fixture.request(path + "/job-receipt", {
      session: null,
      body: { actionId: input.action.actionId, receiptKey: "a".repeat(64) },
    }),
    404,
  );
  expectStatus(
    await fixture.request(path + "/jobs", { session: fixture.otherCookie }),
    404,
  );
  report.status = "waiting_for_real_delivery_evidence";
  await save();
  const final = await waitFor(
    ["confirmed", "failed", "needs_checking"],
    180000,
  );
  report.finalStatus = final.job.status;
  report.finalLabel = final.job.label;
  assert.equal(
    final.job.status,
    "confirmed",
    "Real message delivery was not confirmed; retain the exact evidence.",
  );
  await fixture.restart();
  assert.deepEqual((await read()).body, final);
  const jobs = (await fixture.request(path + "/jobs")).body.jobs;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].canResume, false);
  report.checks.push(
    `${controlled ? "Controlled" : "Real"} delivered-to-mail-server status and the public result survive restart; wrong key/owner rejected and completed work cannot resume`,
  );
  report.status = "passed";
  await save();
  console.log(
    `${controlled ? "Controlled sender rehearsal" : "Real Resend proof"} passed: one email identity, offline Try, closed viewers, durable alarm, accepted-response loss, restart/same-key reconciliation, saved acceptance and delivery evidence. Cleanup follows.`,
  );
} catch (error) {
  report.failedDuring = report.status;
  report.status = "needs_review";
  report.failure =
    error instanceof assert.AssertionError
      ? "A real acceptance assertion failed; inspect the safe checks/status, not credentials."
      : "The real acceptance could not finish; no replacement action was created.";
  await save();
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  if (fixture) {
    try {
      const connection = (await fixture.list()).body.items.find(
        (item) => item.connection.id === "connection-one",
      )?.connection;
      if (connection && connection.status !== "revoked")
        expectStatus(
          await fixture.connection("disconnect", {
            id: connection.id,
            expectedRevision: connection.revision,
          }),
          200,
        );
      report.cleanup.connectionDisconnected = true;
    } catch {
      report.cleanup.connectionDisconnected = false;
    }
    await fixture.close();
    try {
      await access(report.storagePath);
    } catch {
      report.cleanup.fixtureRemoved = true;
    }
  }
  if (!controlled && report.status === "passed") {
    await rm(privatePath, { force: true });
    report.cleanup.privateInputRemoved = true;
  }
  setup = null;
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(
    report.cleanup.privateInputRemoved
      ? "Owned local private input and fixture storage removed. Provider-issued API key revocation remains available in Resend settings."
      : "Fixture storage removed. Private setup is retained for the same authorized diagnostic until its consent deadline or successful cleanup.",
  );
}
