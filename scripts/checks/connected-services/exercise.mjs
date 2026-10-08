import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** Real account reads only. Faulted external writes are covered separately by controlled tests. */
export async function exerciseConnected({ call, record, token, browserCheck }) {
  const ok = async (promise) => {
    const response = await promise;
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  const api = (path, method = "GET", body, foreign = false) =>
    ok(
      call("/api", "POST", {
        path,
        method,
        ...(body === undefined ? {} : { body }),
        foreign,
      }),
    );
  const account = await api("/api/account-connections/connect", "POST", {
    id: "connected-proof",
    expectedRevision: 0,
    setup: { provider: "github", repository: "jaffakakes/pvo-prototype" },
    token,
  });
  assert.equal(
    account.status,
    200,
    "Private read-only account setup must succeed",
  );
  token = null;
  await record("private_account_connected", {
    account: account.body.account,
    repository: account.body.scope.repository,
    permissions: account.body.connection.permissions,
  });
  const initial = await ok(call("/begin", "POST", {}));
  assert(initial.row?.settled && initial.provider?.state === "available");
  const identity = initial.row.identity,
    base = `/api/services/${identity.serviceId}`;
  const okAPI = async (...args) => {
    const response = await api(...args);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  };
  const command = async (kind) => {
    const current = await okAPI(base);
    return api(`${base}/${kind}`, "POST", {
      kind,
      actionId: randomUUID(),
      expectedRevision: current.summary.service.revision,
      ...(kind === "activate" ? { releaseId: identity.resourceId } : {}),
    });
  };
  assert.equal((await command("activate")).status, 403);
  assert.equal(
    (
      await api(
        `${base}/account-access`,
        "POST",
        { kind: "approve", releaseId: identity.resourceId },
        true,
      )
    ).status,
    404,
  );
  await okAPI(`${base}/account-access`, "POST", {
    kind: "approve",
    releaseId: identity.resourceId,
  });
  assert.equal((await command("activate")).status, 200);
  const action = (actionId, name) => ({
    actionId,
    operation: "join",
    input: { name },
  });
  const trial = await okAPI(
    `${base}/releases/${identity.resourceId}/try`,
    "POST",
    action("test-alice", "Alice"),
  );
  assert.equal(trial.result, "accepted");
  const live = await ok(
    call(`${base}/actions`, "POST", action("live-bob", "Bob"), false),
  );
  assert.equal(live.result, "accepted");
  const before = await ok(call("/host", "POST", {}));
  assert.equal(
    (await call("/host", "POST", { action: "restart" })).status,
    503,
  );
  const after = await ok(call("/host", "POST", {}));
  assert.notEqual(before.instanceId, after.instanceId);
  assert.deepEqual(
    await ok(call(`${base}/actions`, "POST", action("live-bob", "Bob"), false)),
    live,
  );
  await record("connected_host_restart_and_replay", {
    identity,
    trial,
    live,
    workshop: "never created",
    account: "real GitHub",
    Node: "Fly isolated immutable runtime",
  });
  if (browserCheck) await browserCheck({ identity, api, call, record });
  await okAPI(`${base}/account-access`, "POST", {
    kind: "revoke",
    releaseId: identity.resourceId,
  });
  assert.equal(
    (
      await call(
        `${base}/actions`,
        "POST",
        action("after-release-revoke", "Denied"),
        false,
      )
    ).status,
    403,
  );
  await okAPI(`${base}/account-access`, "POST", {
    kind: "approve",
    releaseId: identity.resourceId,
  });
  const current = (await okAPI("/api/account-connections")).items[0];
  await okAPI("/api/account-connections/disconnect", "POST", {
    id: current.connection.id,
    expectedRevision: current.connection.revision,
  });
  assert.equal(
    (
      await call(
        `${base}/actions`,
        "POST",
        action("after-account-revoke", "Denied"),
        false,
      )
    ).status,
    409,
  );
  await record("both_revocations_block_new_calls", {
    release: true,
    account: true,
    externalWrites: 0,
  });
}
