import assert from "node:assert/strict";
import { requireFly } from "./api.mjs";
import { ownedMachines, removeOwnedMachine } from "./owned-machines.mjs";

/** The trusted controller owns test Machines only; its parent owns the app, controller and credentials. */
export function cloudProofResources(request, report, save) {
  const path = `/apps/${report.app}`;
  assert.equal(report.app, `restyle-node-proof-${report.id}`);
  assert.match(report.id, /^[a-f0-9]{24}$/);
  assert.match(report.controllerId, /^[a-f0-9]{10,32}$/);
  const inventory = async () => {
    const values = await ownedMachines(request, path, report.id);
    return values.filter((value) => value.id !== report.controllerId);
  };
  const removeMachine = async (machine) => {
    assert.notEqual(
      machine.id,
      report.controllerId,
      "A child controller cannot remove itself",
    );
    await removeOwnedMachine(request, path, report.id, machine);
    const row = report.machines.find((value) => value.name === machine.name);
    if (row) {
      row.removed = true;
      row.removedAt = Date.now();
    }
    await save();
  };
  return {
    request,
    path,
    report,
    save,
    removeMachine,
    async createMachine(files, configure) {
      assert.ok(
        Date.now() < report.deadlineAt - 60000,
        "Cloud proof admission expired",
      );
      assert.ok(
        report.machines.length < 9,
        "Cloud proof start allowance reached",
      );
      assert.equal(
        (await inventory()).filter((value) => value.state !== "destroyed")
          .length,
        0,
        "Previous test cleanup is pending",
      );
      const name = `restyle-${report.id}-${String(report.machines.length + 1).padStart(2, "0")}`;
      const configuration = configure({ name, proofId: report.id, files });
      assert.equal(configuration.name, name);
      assert.equal(configuration.config.metadata.restyle_proof, report.id);
      const row = {
        name,
        id: null,
        attemptedAt: Date.now(),
        removed: false,
        image: configuration.config.image,
        guest: configuration.config.guest,
      };
      report.machines.push(row);
      await save();
      const actual = await requireFly(
        request,
        "POST",
        `${path}/machines`,
        configuration,
        { timeoutMs: 45000 },
      );
      assert.match(actual.id, /^[a-f0-9]{10,32}$/);
      assert.equal(actual.config?.metadata?.restyle_proof, report.id);
      row.id = actual.id;
      row.createdAt = Date.now();
      await save();
      return { ...actual, name };
    },
    async cleanup() {
      for (const value of await inventory()) await removeMachine(value);
      assert.equal(
        (await inventory()).filter((value) => value.state !== "destroyed")
          .length,
        0,
      );
      report.runtimeCleanupVerified = true;
      await save();
    },
  };
}
