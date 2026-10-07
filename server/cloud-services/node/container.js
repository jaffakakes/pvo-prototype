import { NODE_RUNTIME, NODE_LIMITS as limits } from "./runtime.js";
import { withAssistantDeadline } from "../../assistant/deadline.js";

export const nodeExecutionError = (code) =>
  Object.assign(new Error(`Node execution ${code.replaceAll("_", " ")}.`), {
    code,
  });

/** Bound bytes outside the guest, even if generated code replaces the private HTTP listener. */
export async function readNodeReply(response, maximum, signal) {
  if (!response.ok) {
    await response.body?.cancel();
    throw nodeExecutionError(
      response.status === 413 ? "output_limit" : "execution_failed",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw nodeExecutionError("invalid_reply");
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const parts = [];
  let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw nodeExecutionError("output_limit");
      parts.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      throw nodeExecutionError("invalid_reply");
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Native provider effects. The durable controller owns admission, the lease and cleanup receipt. */
export class NodeContainer {
  constructor(container) {
    this.container = container;
  }
  start(id) {
    const image = this.container?.images?.runtime;
    if (typeof image !== "string" || !/@sha256:[a-f0-9]{64}$/.test(image))
      throw nodeExecutionError("runtime_unavailable");
    this.container.start({
      image,
      instance: "lite",
      enableInternet: false,
      labels: { execution: id },
    });
  }
  async ready(assertCurrent, signal) {
    try {
      return await withAssistantDeadline(
        async (current) => {
          await this.container.setInactivityTimeout(limits.leaseMs);
          const image = this.container.images.runtime;
          for (;;) {
            current.throwIfAborted();
            assertCurrent();
            try {
              const inspected = await this.container.inspect();
              current.throwIfAborted();
              assertCurrent();
              if (inspected?.image && inspected.image !== image)
                throw nodeExecutionError("runtime_mismatch");
              if (inspected?.image === image) {
                const response = await this.container
                  .getTcpPort(8080)
                  .fetch("http://runtime/ready", { signal: current });
                const ready = await readNodeReply(response, 1024, current);
                if (
                  ready.nodeVersion !== NODE_RUNTIME.nodeVersion ||
                  ready.runnerDigest !== NODE_RUNTIME.runnerDigest
                )
                  throw nodeExecutionError("runtime_mismatch");
                return ready;
              }
            } catch (error) {
              if (error?.code === "runtime_mismatch") throw error;
              current.throwIfAborted();
              assertCurrent();
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        },
        limits.startupMs,
        signal,
      );
    } catch (error) {
      if (error?.status === 504) throw nodeExecutionError("startup_timeout");
      throw error;
    }
  }
  async execute(bundle, invocation, assertCurrent, signal) {
    const body = JSON.stringify({
      bundle: {
        ...bundle,
        files: bundle.files.filter((file) => file.path.startsWith("src/")),
      },
      invocation,
    });
    if (
      new TextEncoder().encode(body).length > limits.requestBytes ||
      new TextEncoder().encode(JSON.stringify(invocation)).length >
        limits.invocationBytes
    )
      throw nodeExecutionError("input_limit");
    return withAssistantDeadline(
      async (current) => {
        current.throwIfAborted();
        assertCurrent();
        let response;
        try {
          response = await this.container
            .getTcpPort(8080)
            .fetch("http://runtime/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
              signal: current,
            });
        } catch (error) {
          current.throwIfAborted();
          throw nodeExecutionError("runtime_unavailable");
        }
        return readNodeReply(response, limits.replyBytes, current);
      },
      limits.executionMs,
      signal,
    );
  }
  async destroy() {
    await this.container.destroy();
    const remaining = await this.container.inspect();
    if (remaining !== null || this.container.running)
      throw nodeExecutionError("cleanup_unconfirmed");
  }
}
