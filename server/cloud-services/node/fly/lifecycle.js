import { nodeExecutionError } from "../protocol.js";

const machineId = (value) =>
  typeof value === "string" && /^[a-f0-9]{10,32}$/.test(value);

/** Provider compute intent belongs to the existing durable slot lease, never a second service catalog. */
export class FlyMachineLifecycle {
  constructor({ request, read, write, app, image }) {
    if (
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(app) ||
      typeof image !== "string" ||
      !image.startsWith(`registry.fly.io/${app}@sha256:`) ||
      !/@sha256:[a-f0-9]{64}$/.test(image)
    )
      throw nodeExecutionError("runtime_unavailable");
    Object.assign(this, { request, read, write, app, image });
    this.path = `/apps/${app}/machines`;
  }

  intent(execution) {
    const value = this.read();
    if (
      value &&
      (value.execution !== execution ||
        value.app !== this.app ||
        value.image !== this.image)
    )
      throw nodeExecutionError("runtime_mismatch");
    return value;
  }

  async create(execution, configuration) {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(execution))
      throw nodeExecutionError("invalid_input");
    if (this.read()) throw nodeExecutionError("execution_closed");
    const intent = {
      execution,
      app: this.app,
      image: this.image,
      name: `restyle-${execution}`,
      machineId: null,
      phase: "dispatching",
    };
    // A crash or lost reply leaves this obligation in the slot; absence from one list cannot release it.
    this.write(intent);
    const result = await this.request("POST", this.path, {
      ...configuration,
      name: intent.name,
      config: {
        ...configuration.config,
        image: this.image,
        metadata: { restyle_execution: execution },
      },
    });
    if (!result.ok) {
      if ([400, 401, 403, 404, 422, 429].includes(result.status))
        this.write({ ...intent, phase: "rejected" });
      throw nodeExecutionError("runtime_unavailable");
    }
    if (!machineId(result.data?.id))
      throw nodeExecutionError("runtime_unavailable");
    this.write({ ...intent, machineId: result.data.id, phase: "created" });
    return result.data.id;
  }

  assertOwned(machine, intent) {
    if (
      !machineId(machine?.id) ||
      (intent.machineId !== null && machine.id !== intent.machineId) ||
      machine.name !== intent.name ||
      machine.config?.metadata?.restyle_execution !== intent.execution ||
      machine.image_ref?.digest !== intent.image.split("@")[1]
    )
      throw nodeExecutionError("runtime_mismatch");
  }

  async locate(intent) {
    if (intent.machineId) {
      const result = await this.request(
        "GET",
        `${this.path}/${intent.machineId}`,
      );
      if (result.status === 404) return null;
      if (!result.ok) throw nodeExecutionError("cleanup_unconfirmed");
      this.assertOwned(result.data, intent);
      return result.data;
    }
    const result = await this.request("GET", this.path);
    if (!result.ok || !Array.isArray(result.data) || result.data.length > 1000)
      throw nodeExecutionError("cleanup_unconfirmed");
    const matches = result.data.filter(
      (machine) =>
        machine.name === intent.name ||
        machine.config?.metadata?.restyle_execution === intent.execution,
    );
    if (matches.length !== 1) throw nodeExecutionError("cleanup_unconfirmed");
    this.assertOwned(matches[0], intent);
    this.write({ ...intent, machineId: matches[0].id, phase: "created" });
    return matches[0];
  }

  async destroy(execution) {
    const intent = this.intent(execution);
    if (!intent) return;
    if (intent.phase === "rejected") {
      this.write(null);
      return;
    }
    const machine = await this.locate(intent);
    if (machine && machine.state !== "destroyed") {
      const identified = { ...intent, machineId: machine.id };
      this.write({ ...identified, phase: "destroying" });
      const path = `${this.path}/${machine.id}`;
      const result = await this.request("DELETE", `${path}?force=true`);
      if (!result.ok && result.status !== 404)
        throw nodeExecutionError("cleanup_unconfirmed");
      const after = await this.request("GET", path);
      if (after.status !== 404) {
        if (!after.ok) throw nodeExecutionError("cleanup_unconfirmed");
        this.assertOwned(after.data, identified);
        if (after.data.state !== "destroyed")
          throw nodeExecutionError("cleanup_unconfirmed");
      }
    }
    // Persist confirmed removal before the controller can release capacity or return a result.
    this.write(null);
  }
}
