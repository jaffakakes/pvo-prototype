import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** Interrupt real private compute after its provider identity is durable; recover through existing cancel/alarm cleanup. */
export async function checkComputeRestart({ call, identity, record }) {
  const action = {
    actionId: "node-restart-retry",
    operation: "join",
    input: { name: "Bob" },
  };
  const path = `/api/services/${identity.serviceId}/actions`;
  let outcome = null;
  const settled = call(path, "POST", action, false)
    .then((result) => {
      outcome = result;
      return result;
    })
    .catch((error) => {
      outcome = { status: 503, data: { error: error.name } };
      return outcome;
    });
  const deadline = Date.now() + 120000;
  let owned;
  while (!outcome && Date.now() < deadline) {
    const snapshot = await call("/slots");
    assert.equal(snapshot.status, 200);
    const slot = snapshot.data.findIndex(
      (value) =>
        value.lease?.phase === "running" && value.lease.provider?.machineId,
    );
    if (slot >= 0) {
      owned = { slot, lease: snapshot.data[slot].lease };
      break;
    }
    await delay(500);
  }
  assert(owned, "A real owned Machine must be observed before the restart");
  await record("compute_restart_intent", owned);
  assert.equal(
    (await call("/node", "POST", { slot: owned.slot, action: "restart" }))
      .status,
    503,
  );
  assert.equal(
    (await call("/node", "POST", { slot: owned.slot, action: "expire" }))
      .status,
    200,
  );
  const interrupted = await settled;
  assert.notEqual(
    interrupted.status,
    200,
    "Interrupted execution cannot commit a success",
  );
  let absent = false;
  const cleanupDeadline = Date.now() + 90000;
  while (Date.now() < cleanupDeadline) {
    const snapshot = await call("/slots");
    assert.equal(snapshot.status, 200);
    if (snapshot.data.every((value) => value.lease === null)) {
      absent = true;
      break;
    }
    await delay(1000);
  }
  assert(
    absent,
    "Durable cleanup must release capacity only after Machine destruction",
  );
  const recovered = await call(path, "POST", action, false);
  assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
  assert.equal(recovered.data.result, "already_joined");
  await record("compute_restart_recovers_original_action", {
    provider: owned.lease.provider,
    interrupted,
    recovered,
  });
}
