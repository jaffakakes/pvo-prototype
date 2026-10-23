import assert from "node:assert/strict";
import test from "node:test";
import {
  createJob,
  claimJob,
  settleJob,
  failJob,
  parseJobRequest,
  viewerJobReceipt,
  requireJobKey,
  JOB_LIMITS,
} from "../../packages/pvo-assistant/jobs/index.js";
const now = Date.UTC(2026, 9, 8);
const request = {
  releaseId: `release-${"a".repeat(64)}`,
  action: {
    actionId: "one",
    operation: "join",
    input: { name: "Private name" },
  },
  receiptKey: "b".repeat(64),
  schedule: null,
};
const job = () =>
  createJob(
    { serviceId: `service-${"c".repeat(64)}`, ownerId: "owner" },
    parseJobRequest(request, now),
    "d".repeat(64),
    "e".repeat(64),
    now,
  );

test("a viewer job captures its owner, immutable release, input identity and private receipt scope", () => {
  const value = job();
  assert.equal(value.status, "received");
  assert.equal(value.attempts, 0);
  assert.equal(value.nextAt, now);
  assert.equal(value.expiresAt, now + JOB_LIMITS.lifetimeMs);
  assert.throws(() => requireJobKey(value, request.receiptKey));
  requireJobKey(value, "e".repeat(64));
  const receipt = viewerJobReceipt(value);
  assert.equal(receipt.job.label, "Request received");
  for (const secret of ["Private name", "owner", "eeeeeeee", "inputDigest"])
    assert.ok(!JSON.stringify(receipt).includes(secret));
});
test("one durable claim survives its lease and retries have increasing delays and a bound", () => {
  let value = claimJob(job(), now, "first");
  assert.equal(claimJob(value, now + 1, "other"), null);
  value = claimJob(value, now + JOB_LIMITS.leaseMs, "recovery");
  assert.equal(value.attempts, 2);
  value = failJob(value, "busy", false, now + JOB_LIMITS.leaseMs);
  assert.equal(value.nextAt, now + JOB_LIMITS.leaseMs + 10000);
  assert.equal(claimJob(value, value.nextAt - 1, "early"), null);
  value.attempts = JOB_LIMITS.attempts;
  assert.equal(
    failJob(value, "busy", false, value.nextAt).status,
    "needs_checking",
  );
});
test("an unknown external write never becomes a retry or a false failure", () => {
  const value = failJob(
    claimJob(job(), now, "one"),
    "network_error",
    true,
    now + 1,
  );
  assert.equal(value.status, "needs_checking");
  assert.equal(value.nextAt, null);
  assert.equal(value.purgeAt, null);
  assert.equal(claimJob(value, now + 100000000, "two"), null);
  assert.equal(failJob(job(), "invalid_result", false, now).status, "failed");
  assert.equal(
    settleJob(job(), "confirmed", null, now, "accepted").purgeAt,
    now + JOB_LIMITS.retentionMs,
  );
});
test("schedules retain an absolute instant and timezone and reject unsupported or unbounded times", () => {
  const scheduled = {
    ...request,
    schedule: { at: now + 10000, timezone: "Europe/London" },
  };
  const parsed = parseJobRequest(scheduled, now);
  const value = createJob(
    { serviceId: "service", ownerId: "owner" },
    parsed,
    "input",
    "viewer",
    now,
  );
  assert.equal(value.nextAt, now + 10000);
  assert.equal(claimJob(value, now, "early"), null);
  assert.throws(() =>
    parseJobRequest(
      {
        ...scheduled,
        schedule: { ...scheduled.schedule, timezone: "made/up" },
      },
      now,
    ),
  );
  assert.throws(() =>
    parseJobRequest(
      {
        ...scheduled,
        schedule: {
          ...scheduled.schedule,
          at: now + JOB_LIMITS.scheduleMs + 1,
        },
      },
      now,
    ),
  );
});
