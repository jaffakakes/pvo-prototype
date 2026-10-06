import assert from "node:assert/strict";

export async function exerciseWorkspaces(call, record = async () => {}) {
  assert.equal((await call("/recovery/status", "GET", false)).status, 401);
  const request = async (subject, action, method = "POST") => {
    const response = await call(`/${subject}/${action}`, method);
    assert.equal(
      response.status,
      200,
      `Workspace ${subject}/${action} failed: ${JSON.stringify(response.data)}`,
    );
    return response.data;
  };
  const saved = await request("recovery", "save");
  assert.equal(saved.status, "completed");
  const lost = await call("/recovery/start", "POST");
  assert.equal(
    lost.status,
    409,
    "Forced coordinator reset must not report a completed start",
  );
  const recovered = await request("recovery", "status", "GET");
  assert.equal(recovered.absent, true);
  assert.equal(recovered.cleanupRequired, false);
  assert.equal(recovered.lease, null);
  assert.equal(recovered.source.digest, saved.result.digest);
  assert.equal(
    (await request("recovery", "receipt", "GET")).status,
    "interrupted",
  );
  await record(
    "Saved source and the same logical workspace recovered after reset before the start receipt",
    {
      resourceId: recovered.identity.resourceId,
      digest: recovered.source.digest,
    },
  );
  const restarted = await request("recovery", "restart");
  assert.equal(restarted.status, "completed");
  assert.deepEqual(await request("recovery", "restart"), restarted);
  const live = await request("recovery", "status", "GET");
  assert.equal(live.lease.session, 2);
  const executed = await request("recovery", "execute");
  assert.equal(executed.status, "completed");
  assert.equal(executed.result.exitCode, 0);
  assert.match(executed.result.stdout, /workspace fixture verified/);
  await record(
    "Fresh restoration ran the saved Node tests with Internet blocked and platform credentials absent",
  );
  const stopped = await request("recovery", "stop");
  assert.equal(stopped.closed, true);
  assert.equal(stopped.cleanupRequired, false);
  assert.equal(stopped.source.digest, saved.result.digest);
  assert.equal((await call("/recovery/late-start", "POST")).status, 409);
  await request("stopped", "stop");
  assert.equal((await call("/stopped/save", "POST")).status, 409);
  assert.equal((await request("stopped", "status", "GET")).absent, true);
  await record(
    "Stop retained source and prevented late creation, including Stop before initialization",
  );
  for (const subject of ["timeout", "output"]) {
    await request(subject, "save");
    assert.equal((await request(subject, "start")).status, "completed");
    const result = await request(subject, "execute");
    assert.equal(result.status, "interrupted");
    assert.equal(
      result.result.code,
      subject === "output"
        ? "workspace_output_limit"
        : "workspace_execution_interrupted",
    );
    const status = await request(subject, "status", "GET");
    assert.equal(status.absent, true);
    assert.equal(status.cleanupRequired, false);
    assert.equal(status.lease, null);
    assert.ok(status.source);
    await record(
      subject === "timeout"
        ? "Command deadline destroyed the whole Container, including its spawned child"
        : "Combined output limit stopped execution and retained saved source",
    );
  }
  return { passed: true };
}
