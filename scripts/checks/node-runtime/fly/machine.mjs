import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { requireFly } from "./api.mjs";
import {
  NODE_RUNTIME,
  NODE_LIMITS,
} from "../../../../server/cloud-services/node/runtime.js";
import {
  nodeExecutionBody,
  readNodeReply,
  nodeExecutionError,
} from "../../../../server/cloud-services/node/container.js";

/** Fixed diagnostic calls only; every instance is removed before the next case. */
export class FlyProofMachine {
  constructor(resources, record) {
    this.resources = resources;
    this.record = record;
    this.path = `${resources.path}/machines/${record.id}`;
  }
  async start() {
    const { request } = this.resources;
    const expected = NODE_RUNTIME.baseImage.split("@")[1];
    const deadline = Date.now() + NODE_LIMITS.startupMs;
    const remaining = () => {
      const value = deadline - Date.now();
      if (value <= 0) throw nodeExecutionError("startup_timeout");
      return value;
    };
    try {
      let startRequested = false;
      for (;;) {
        const state = await requireFly(request, "GET", this.path, undefined, {
          timeoutMs: remaining(),
        });
        assert.equal(
          state.image_ref?.digest,
          expected,
          "Fly resolved a different Node base image",
        );
        if (state.state === "stopped" && !startRequested) {
          await requireFly(
            request,
            "POST",
            `${this.path}/start`,
            {},
            { timeoutMs: remaining() },
          );
          startRequested = true;
          continue;
        }
        if (state.state === "started") {
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
          (state.state === "stopped" && startRequested) ||
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
  async command(command, { timeoutMs = 4000 } = {}) {
    const data = await requireFly(
      this.resources.request,
      "POST",
      `${this.path}/exec`,
      {
        cmd: command
          .map((value) => "'" + value.replaceAll("'", "'\"'\"'") + "'")
          .join(" "),
        timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
      },
      { timeoutMs },
    );
    // Fly omits the zero-valued exit_code field on successful commands.
    const exitCode = data?.exit_code === undefined ? 0 : data.exit_code;
    if (exitCode !== 0 || typeof data?.stdout !== "string") {
      // This is a private fixed-fixture diagnostic, never the product error surface.
      this.resources.report.commandFailure = {
        machine: this.record.id,
        fields: data && typeof data === "object" ? Object.keys(data) : [],
        exitCode: data?.exit_code ?? null,
        exitSignal: data?.exit_signal ?? null,
        stderr:
          typeof data?.stderr === "string" ? data.stderr.slice(0, 2048) : null,
      };
      await this.resources.save();
      throw nodeExecutionError("execution_failed");
    }
    if (Buffer.byteLength(data.stdout) > 160 * 1024)
      throw nodeExecutionError("output_limit");
    return data.stdout;
  }
  async bridge(payload, timeoutMs = 4000) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    const chunks = encoded.match(/.{1,65536}/g) ?? [];
    const raw = await this.command(["node", "/runtime/bridge.mjs", ...chunks], {
      timeoutMs,
    });
    let reply;
    try {
      reply = JSON.parse(raw);
    } catch {
      throw nodeExecutionError("invalid_reply");
    }
    if (reply?.status === 504) throw nodeExecutionError("timeout");
    if (payload.path === "/ready" && reply?.status === 503)
      throw nodeExecutionError("startup_pending");
    if (
      !Number.isInteger(reply?.status) ||
      reply.status < 200 ||
      reply.status > 599 ||
      [204, 205, 304].includes(reply.status) ||
      typeof reply.body !== "string"
    )
      throw nodeExecutionError("invalid_reply");
    return readNodeReply(
      new Response(reply.body, { status: reply.status }),
      NODE_LIMITS.replyBytes,
      new AbortController().signal,
    );
  }
  async execute(bundle, invocation) {
    try {
      const body = nodeExecutionBody(bundle, invocation);
      if (
        Buffer.byteLength(body) > NODE_LIMITS.requestBytes ||
        Buffer.byteLength(JSON.stringify(invocation)) >
          NODE_LIMITS.invocationBytes
      )
        throw nodeExecutionError("input_limit");
      return await this.bridge(
        { path: "/execute", body },
        NODE_LIMITS.executionMs,
      );
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError")
        throw nodeExecutionError("timeout");
      throw error;
    }
  }
  async destroy() {
    await this.resources.removeMachine(this.record);
  }
}
