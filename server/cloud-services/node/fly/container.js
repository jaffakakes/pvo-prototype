import { NODE_RUNTIME, NODE_LIMITS } from "../runtime.js";
import { nodeExecutionBody, nodeExecutionError } from "../protocol.js";
import { withAssistantDeadline } from "../../../assistant/deadline.js";
import { flyMachineApi } from "./api.js";
import { FlyMachineLifecycle } from "./lifecycle.js";
import { FlyCommands } from "./commands.js";
import { prepareFlyInput, uploadFlyInput } from "./input.js";
import { flyClock } from "./timing.js";

/** The provider effect for one existing durable execution lease. It owns no service data or releases. */
export class FlyNodeContainer {
  constructor({
    app,
    token,
    image,
    read,
    write,
    fetchImpl = fetch,
    clock = flyClock,
  }) {
    if (!app || !token || !image)
      throw nodeExecutionError("runtime_unavailable");
    if (image !== `registry.fly.io/${app}@${NODE_RUNTIME.imageDigest}`)
      throw nodeExecutionError("runtime_mismatch");
    this.request = flyMachineApi({ app, token, fetchImpl });
    this.lifecycle = new FlyMachineLifecycle({
      request: this.request,
      read,
      write,
      app,
      image,
    });
    this.image = image;
    this.read = read;
    this.write = write;
    this.clock = clock;
  }

  async start(execution, body, assertCurrent, signal) {
    this.execution = execution;
    this.body = body;
    this.delivery = await prepareFlyInput(body);
    signal.throwIfAborted();
    assertCurrent();
    const id = await this.lifecycle.create(execution, {
      region: "iad",
      skip_launch: true,
      skip_service_registration: true,
      skip_secrets: true,
      config: {
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
        init: {
          exec: [
            "/usr/bin/timeout",
            "--signal=KILL",
            "180",
            "node",
            "/runtime/supervisor.mjs",
          ],
        },
        restart: { policy: "no" },
        auto_destroy: false,
        dns: { skip_registration: true },
        services: [],
        mounts: [],
        env: {},
        files: this.delivery.files,
      },
    });
    this.path = `${this.lifecycle.path}/${id}`;
    this.commands = new FlyCommands(this.request, this.path, this.clock);
  }

  async inspect(signal) {
    const response = await this.request("GET", this.path, undefined, {
      signal,
    });
    if (!response.ok) throw nodeExecutionError("runtime_unavailable");
    const intent = this.lifecycle.intent(this.execution);
    if (!intent) throw nodeExecutionError("execution_cancelled");
    this.lifecycle.assertOwned(response.data, intent);
    return response.data;
  }

  async ready(assertCurrent, signal) {
    try {
      await withAssistantDeadline(
        async (current) => {
          for (;;) {
            current.throwIfAborted();
            assertCurrent();
            const machine = await this.inspect(current);
            current.throwIfAborted();
            assertCurrent();
            if (["stopped", "started"].includes(machine.state)) return;
            if (["failed", "destroyed"].includes(machine.state))
              throw nodeExecutionError("runtime_unavailable");
            await this.clock.sleep(300, current);
          }
        },
        120000,
        signal,
      );
      await withAssistantDeadline(
        async (current) => {
          let started = false;
          for (;;) {
            current.throwIfAborted();
            assertCurrent();
            const machine = await this.inspect(current);
            current.throwIfAborted();
            assertCurrent();
            if (machine.state === "stopped" && !this.read().startRequested) {
              // A lost start response is observed on this same Machine, never dispatched twice.
              this.write({ ...this.read(), startRequested: true });
              try {
                const response = await this.request(
                  "POST",
                  `${this.path}/start`,
                  {},
                  { signal: current },
                );
                if (!response.ok)
                  throw nodeExecutionError("runtime_unavailable");
              } catch (error) {
                current.throwIfAborted();
                if (
                  !["TypeError", "AbortError", "TimeoutError"].includes(
                    error.name,
                  )
                )
                  throw error;
              }
            } else if (machine.state === "started") {
              started = true;
              try {
                const value = await this.commands.bridge("ready", current);
                if (
                  value.nodeVersion !== NODE_RUNTIME.nodeVersion ||
                  value.runnerDigest !== NODE_RUNTIME.runnerDigest
                )
                  throw nodeExecutionError("runtime_mismatch");
                return;
              } catch (error) {
                current.throwIfAborted();
                if (
                  error.code !== "startup_pending" &&
                  !["AbortError", "TimeoutError"].includes(error.name)
                )
                  throw error;
              }
            } else if (
              ["failed", "destroyed"].includes(machine.state) ||
              (machine.state === "stopped" && started)
            )
              throw nodeExecutionError("runtime_unavailable");
            await this.clock.sleep(300, current);
          }
        },
        NODE_LIMITS.startupMs,
        signal,
      );
      await uploadFlyInput(this.commands, this.delivery, {
        signal,
        assertCurrent,
      });
      signal.throwIfAborted();
      assertCurrent();
    } catch (error) {
      if (error.status === 504 || error.code === "upload_timeout")
        throw nodeExecutionError("startup_timeout");
      throw error;
    }
  }

  async execute(bundle, invocation, assertCurrent, signal) {
    signal.throwIfAborted();
    assertCurrent();
    if (nodeExecutionBody(bundle, invocation) !== this.body)
      throw nodeExecutionError("invalid_input");
    const result = await this.commands.bridge("execute", signal);
    signal.throwIfAborted();
    assertCurrent();
    return result;
  }

  destroy(execution) {
    return this.lifecycle.destroy(execution);
  }
}
