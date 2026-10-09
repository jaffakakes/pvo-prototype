import assert from "node:assert/strict";
import { requireFly } from "./api.mjs";

export async function ownedMachines(request, path, proofId) {
  const values = await requireFly(request, "GET", `${path}/machines`);
  assert.ok(Array.isArray(values));
  for (const value of values) {
    assert.equal(
      value.config?.metadata?.restyle_proof,
      proofId,
      "Unexpected Machine in owned proof app; preserve it",
    );
    assert.match(value.id, /^[a-f0-9]{10,32}$/);
  }
  return values;
}

export async function removeOwnedMachine(request, path, proofId, machine) {
  assert.equal(
    machine.config?.metadata?.restyle_proof,
    proofId,
    "Refuse destruction without matching ownership",
  );
  assert.match(machine.id, /^[a-f0-9]{10,32}$/);
  const target = `${path}/machines/${machine.id}`;
  const before = await request("GET", target);
  if (before.status !== 404) {
    assert.ok(before.ok, "Machine ownership inspection failed");
    assert.equal(
      before.data?.config?.metadata?.restyle_proof,
      proofId,
      "Machine ownership changed; preserve it",
    );
    if (before.data.state !== "destroyed") {
      const deleted = await request("DELETE", `${target}?force=true`);
      assert.ok(
        deleted.ok || deleted.status === 404,
        `Machine deletion failed (${deleted.status})`,
      );
    }
  }
  const absent = await request("GET", target);
  assert.ok(
    absent.status === 404 || (absent.ok && absent.data?.state === "destroyed"),
    "Machine destruction not confirmed",
  );
}
