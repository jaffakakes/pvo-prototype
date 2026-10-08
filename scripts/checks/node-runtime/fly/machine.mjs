import {
  FlyCommands,
  readFlyReply,
} from "../../../../server/cloud-services/node/fly/commands.js";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { requireFly } from "./api.mjs";
import {
  NODE_RUNTIME,
  NODE_LIMITS,
} from "../../../../server/cloud-services/node/runtime.js";
import {
  nodeExecutionBody,
  nodeExecutionError,
} from "../../../../server/cloud-services/node/protocol.js";

/** Fixed diagnostic calls only; every instance is removed before the next case. */
export class FlyProofMachine {
  constructor(
    resources,
    record,
    {
      image = NODE_RUNTIME.baseImage,
      bridgePath = "/runtime/bridge.mjs",
      executionMs = NODE_LIMITS.executionMs,
      preparationMs = NODE_LIMITS.startupMs,
      invocationBody = null,
      clock = { now: () => Date.now(), sleep: delay },
    } = {},
  ) {
    this.resources = resources;
    this.record = record;
    this.path = `${resources.path}/machines/${record.id}`;
    this.image = image;
    this.bridgePath = bridgePath;
    this.executionMs = executionMs;
    this.preparationMs = preparationMs;
    this.invocationBody = invocationBody;
    this.commands = new FlyCommands(
      async (...args) => {
        const result = await this.resources.request(...args);
        if (result.ok) {
          const data = result.data;
          this.lastCommand = {
            fields: Object.keys(data ?? {}),
            exitCode: data?.exit_code ?? 0,
            exitSignal: data?.exit_signal ?? null,
            stdoutBytes:
              typeof data?.stdout === "string"
                ? Buffer.byteLength(data.stdout)
                : null,
            stderr:
              typeof data?.stderr === "string"
                ? data.stderr.slice(0, 2048)
                : null,
          };
          if (
            (data?.exit_code ?? 0) !== 0 ||
            (data?.exit_signal ?? 0) !== 0 ||
            typeof data?.stdout !== "string"
          ) {
            this.resources.report.commandFailure = {
              machine: this.record.id,
              ...this.lastCommand,
            };
            await this.resources.save();
          }
        }
        return result;
      },
      this.path,
      clock,
    );
  }
  async start() {
    const { request } = this.resources;
    const expected = this.image.split("@")[1];
    const startedAt = Date.now();
    let deadline = startedAt + this.preparationMs;
    const remaining = () => {
      const value = deadline - Date.now();
      if (value <= 0) throw nodeExecutionError("startup_timeout");
      return value;
    };
    try {
      let startRequested = false;
      let hasStarted = false;
      for (;;) {
        const state = await requireFly(request, "GET", this.path, undefined, {
          timeoutMs: remaining(),
        });
        assert.equal(
          state.image_ref?.digest,
          expected,
          "Fly resolved a different immutable runtime image",
        );
        if (state.state === "stopped" && !startRequested) {
          this.preparedMs = Date.now() - startedAt;
          deadline = Date.now() + NODE_LIMITS.startupMs;
          startRequested = true;
          await requireFly(
            request,
            "POST",
            `${this.path}/start`,
            {},
            { timeoutMs: remaining() },
          );
          continue;
        }
        if (state.state === "started") {
          if (!startRequested && !hasStarted) {
            this.preparedMs = Date.now() - startedAt;
            deadline = Date.now() + NODE_LIMITS.startupMs;
          }
          hasStarted = true;
          try {
            const ready = await this.bridge(
              { path: "/ready" },
              Math.min(4000, remaining()),
            );
            assert.equal(ready.nodeVersion, NODE_RUNTIME.nodeVersion);
            assert.equal(ready.runnerDigest, NODE_RUNTIME.runnerDigest);
            return;
          } catch (error) {
            if (
              error.code !== "startup_pending" &&
              !["AbortError", "TimeoutError"].includes(error.name)
            )
              throw error;
          }
        }
        if (
          (state.state === "stopped" && hasStarted) ||
          ["destroyed", "failed"].includes(state.state)
        )
          throw new Error(
            `Fly Machine failed during startup (${state.state}).`,
          );
        await delay(Math.min(300, remaining()));
      }
    } catch (error) {
      if (["AbortError", "TimeoutError"].includes(error.name))
        throw nodeExecutionError("startup_timeout");
      throw error;
    }
  }
  command(command, options = {}) {
    return this.commands.command(command, { timeoutMs: 4000, ...options });
  }
  async bridge(payload, timeoutMs = 4000) {
    const encoded = Buffer.from(payload.body ?? "").toString("base64");
    const chunks = encoded.match(/.{1,65536}/g) ?? [];
    const mode = payload.path === "/ready" ? "--ready" : "--execute";
    const args = this.invocationBody === null ? [mode, ...chunks] : [mode];
    const raw = await this.command(["node", this.bridgePath, ...args], {
      timeoutMs,
    });
    try {
      return await readFlyReply(
        raw,
        payload.path === "/ready" ? "ready" : "execute",
      );
    } catch (error) {
      if (error.code === "invalid_reply") {
        this.resources.report.transportFailure = {
          ...this.lastCommand,
          raw: raw.slice(0, 512),
        };
        await this.resources.save();
      }
      throw error;
    }
  }

  async execute(bundle, invocation) {
    try {
      const body = nodeExecutionBody(bundle, invocation);
      if (this.invocationBody !== null && body !== this.invocationBody)
        throw nodeExecutionError("invalid_input");
      if (
        Buffer.byteLength(body) > NODE_LIMITS.requestBytes ||
        Buffer.byteLength(JSON.stringify(invocation)) >
          NODE_LIMITS.invocationBytes
      )
        throw nodeExecutionError("input_limit");
      return await this.bridge({ path: "/execute", body }, this.executionMs);
    } catch (error) {
      if (
        !error.code &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      )
        throw nodeExecutionError("timeout");
      throw error;
    }
  }
  async destroy() {
    await this.resources.removeMachine(this.record);
  }
}
