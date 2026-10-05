import assert from "node:assert/strict";

/** Fixed acceptance sequence shared by the local diagnostic check and paid provider proof. */
export async function exerciseRecovery(
  call,
  { cpu = false, record = async () => {} } = {},
) {
  const expect = (response, status) => {
    assert.equal(response.status, status, JSON.stringify(response.data));
    return response.data;
  };
  const status = async (mode) => expect(await call(`/${mode}/status`), 200);
  expect(await call("/recover/status", "GET", false), 401);
  const before = await status("recover");
  expect(await call("/recover/begin", "POST"), 502);
  const crashed = await status("recover");
  assert.notEqual(crashed.instanceId, before.instanceId);
  assert.equal(crashed.task.state, "running");
  assert.equal(crashed.row.settled, false);
  assert.equal(crashed.provider.state, "available");
  assert.equal(crashed.calls, 1);
  await record(
    "Provider creation persisted across forced coordinator reset before its receipt.",
    crashed,
  );

  const unavailable = expect(
    await call("/recover/lookup-failure", "POST"),
    200,
  );
  assert.equal(unavailable.row.settled, false);
  assert.equal(unavailable.row.cancelRequested, false);
  assert.equal(unavailable.row.attempts, 1);
  assert.equal(unavailable.calls, 1);
  await record(
    "Unavailable lookup did not report absence or create another service.",
  );
  const adopted = expect(await call("/recover/reconcile", "POST"), 200);
  assert.equal(adopted.row.outcome, "completed");
  assert.equal(adopted.task.usage.toolCalls, 1);
  assert.equal(adopted.task.usage.reservedToolCalls, 0);
  assert.equal(
    adopted.row.identity.resourceId,
    crashed.row.identity.resourceId,
  );
  const replayed = expect(await call("/recover/replay", "POST"), 200);
  assert.equal(replayed.calls, 1);
  assert.equal(replayed.task.operations.length, 1);
  const executed = expect(await call("/recover/probe", "POST"), 200);
  assert.equal(executed.result.status, 200);
  assert.deepEqual(JSON.parse(executed.result.body), {
    answer: 42,
    blocked: true,
    keys: [],
    auth: null,
  });
  assert.equal(
    expect(await call("/recover/oversize", "POST"), 200).error,
    "probe_rejected",
  );
  if (cpu)
    assert.equal(
      expect(await call("/recover/spin", "POST"), 200).error,
      "cpu_limit",
    );
  await record(
    "Original release was adopted once, reused by a new claim and executed with isolation and byte limits.",
    replayed,
  );
  if (cpu)
    await record(
      "Cloudflare enforced the configured 50 ms generated-code CPU limit.",
    );
  const stopped = expect(await call("/recover/stop", "POST"), 200);
  assert.equal(stopped.task.state, "stopped");
  assert.equal(stopped.provider.state, "deleted");
  assert.equal(stopped.row.outcome, "completed");

  const pending = call("/cancel/begin", "POST");
  let dispatched;
  for (let attempt = 0; attempt < 10; attempt++) {
    dispatched = await status("cancel");
    if (dispatched.row?.dispatched) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(dispatched.row?.dispatched, true);
  const cancelled = expect(await call("/cancel/stop", "POST"), 200);
  assert.equal(cancelled.row.cancelled, true);
  assert.equal(cancelled.row.outcome, "absent");
  expect(await pending, 200);
  let late;
  for (let attempt = 0; attempt < 10; attempt++) {
    late = await status("cancel");
    if (late.calls === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(late.calls, 1);
  assert.equal(late.provider.state, "deleted");
  assert.equal(late.task.state, "stopped");
  await record(
    "Stop cancelled a missing identity before the delayed real publish; its tombstone prevented resurrection.",
    late,
  );
  return { recovery: stopped, cancellation: late };
}
