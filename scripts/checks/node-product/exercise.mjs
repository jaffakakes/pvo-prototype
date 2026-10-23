import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** Identical lifecycle assertions for local preparation and the bounded live product proof. */
export async function exerciseProduct({
  call,
  record,
  browserCheck = null,
  interruptionCheck = null,
}) {
  const requireOK = async (promise) => {
    const r = await promise;
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const initial = await call("/begin", "POST", {});
  assert.equal(
    initial.status,
    503,
    "The committed publication response must be deliberately lost",
  );
  const interrupted = await requireOK(call("/status"));
  assert(interrupted.row?.dispatched);
  assert.equal(interrupted.row.settled, false);
  const recovered = await requireOK(call("/reconcile", "POST", {}));
  assert.equal(recovered.row.settled, true);
  assert.deepEqual(recovered.row.identity, interrupted.row.identity);
  const identity = recovered.row.identity;
  await record("publication_restart_recovered", {
    identity,
    state: recovered.provider.state,
  });
  const probe = await requireOK(call("/host", "POST", { action: "probe" }));
  await record("inactive_node_library_probe", { result: probe });
  const base = `/api/services/${identity.serviceId}`;
  const api = async (path = base, method = "GET", body, foreign = false) =>
    requireOK(
      call("/api", "POST", {
        path,
        method,
        ...(body === undefined ? {} : { body }),
        foreign,
      }),
    );
  const okAPI = async (...args) => {
    const r = await api(...args);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const summary = () => okAPI();
  const command = async (kind, releaseId = identity.resourceId) => {
    const current = await summary();
    const body = {
      kind,
      actionId: randomUUID(),
      expectedRevision: current.summary.service.revision,
      ...(kind === "activate" ? { releaseId } : {}),
    };
    const result = await okAPI(`${base}/${kind}`, "POST", body);
    return { body, result };
  };
  const action = (id, name) => ({
    actionId: id,
    operation: "join",
    input: { name },
  });
  const publicCall = (body) => call(`${base}/actions`, "POST", body, false);
  assert(
    [403, 404, 410].includes((await api(base, "GET", undefined, true)).status),
  );
  const draft = await okAPI(`${base}/draft`);
  assert.equal(draft.content.dependencies[0].version, "5.1.6");
  const activation = await command("activate");
  const beforeRestart = await requireOK(call("/host", "POST", {}));
  const test = await okAPI(
    `${base}/releases/${identity.resourceId}/try`,
    "POST",
    action("test-alice", "Alice"),
  );
  assert.equal(test.result, "accepted");
  const accepted = await requireOK(publicCall(action("live-bob", "Bob")));
  assert.equal(accepted.result, "accepted", "Try cannot consume live capacity");
  assert.equal(
    (await call("/host", "POST", { action: "restart" })).status,
    503,
  );
  const afterRestart = await requireOK(call("/host", "POST", {}));
  assert.notEqual(afterRestart.instanceId, beforeRestart.instanceId);
  assert.deepEqual(afterRestart.draft, beforeRestart.draft);
  const replay = await requireOK(publicCall(action("live-bob", "Bob")));
  assert.deepEqual(replay, accepted);
  const activationReplay = await okAPI(
    `${base}/activate`,
    "POST",
    activation.body,
  );
  assert.deepEqual(activationReplay.receipt, activation.result.receipt);
  const full = await requireOK(publicCall(action("live-carol", "Carol")));
  assert.equal(full.result, "full");
  await record("host_instance_restart_data_and_replay", {
    accepted,
    replay,
    test,
    full,
  });
  const invalid = await requireOK(
    call("/version", "POST", { variant: "invalid" }),
  );
  assert.equal(invalid.report.status, "failed");
  assert.equal(
    (await summary()).summary.service.liveReleaseId,
    identity.resourceId,
  );
  const updated = await requireOK(
    call("/version", "POST", { variant: "updated" }),
  );
  assert.equal(updated.report.status, "passed");
  assert.notEqual(updated.identity.packageDigest, identity.packageDigest);
  assert(
    (await summary()).summary,
    JSON.stringify(await requireOK(call("/host", "POST", {}))),
  );
  assert.equal(
    (await summary()).summary.service.liveReleaseId,
    identity.resourceId,
  );
  await command("activate", updated.identity.resourceId);
  assert.equal(
    (await requireOK(publicCall(action("after-update", "Bob")))).result,
    "already_joined",
  );
  assert.deepEqual(
    await requireOK(publicCall(action("live-bob", "Bob"))),
    accepted,
  );
  await command("activate");
  assert.equal(
    (await requireOK(publicCall(action("after-rollback", "Carol")))).result,
    "full",
  );
  await record("checked_update_and_rollback_preserve_data", {
    failed: invalid.report,
    updated: updated.identity,
  });
  if (browserCheck)
    await browserCheck({ identity, recovered, api, call, record });
  if (interruptionCheck) await interruptionCheck({ identity, call, record });
  const abandoned = await requireOK(
    call("/version", "POST", { variant: "abandoned" }),
  );
  const abandonedTest = await okAPI(
    `${base}/releases/${abandoned.identity.resourceId}/try`,
    "POST",
    action("abandoned-test", "Alice"),
  );
  assert.equal(abandonedTest.result, "accepted");
  const retained = await requireOK(call("/host", "POST", {}));
  const swept = await requireOK(
    call("/host", "POST", {
      action: "sweep",
      at: abandoned.identity.expiresAt + 1,
    }),
  );
  assert.equal(
    swept.releases.find((r) => r.id === abandoned.identity.resourceId).present,
    false,
  );
  assert(swept.releases.find((r) => r.id === identity.resourceId).present);
  assert(
    swept.releases.find((r) => r.id === updated.identity.resourceId).present,
  );
  assert.deepEqual(swept.draft, retained.draft);
  assert.deepEqual(
    await requireOK(publicCall(action("live-bob", "Bob"))),
    accepted,
  );
  await command("pause");
  assert.equal((await publicCall(action("paused", "Carol"))).status, 404);
  const paused = await requireOK(
    call("/host", "POST", {
      action: "sweep",
      at: abandoned.identity.expiresAt + 2,
    }),
  );
  assert.equal(paused.service.state, "paused");
  assert.deepEqual(paused.draft, retained.draft);
  await command("activate");
  assert.deepEqual(
    await requireOK(publicCall(action("live-bob", "Bob"))),
    accepted,
  );
  const records = await okAPI(`${base}/records`);
  await record("retention_and_pause_preserve_saved_work", {
    releases: swept.releases,
    records,
  });
  await command("delete");
  assert.equal((await publicCall(action("deleted", "Carol"))).status, 404);
  const deleted = await requireOK(call("/host", "POST", {}));
  assert.equal(deleted.draft, null);
  assert(deleted.releases.every((r) => !r.present));
  await record("deleted_service_cannot_restart", { service: deleted.service });
  return { identity };
}
