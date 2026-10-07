import { nodeExecutionError, readNodeReply } from "../protocol.js";
import { NODE_LIMITS } from "../runtime.js";
import { flyClock } from "./timing.js";

/** Fixed host commands; credentials, expected answers and authority stay in the caller. */
export class FlyCommands {
  constructor(request, path, clock = flyClock) {
    this.request = request;
    this.path = path;
    this.clock = clock;
    this.tail = Promise.resolve();
    this.nextAt = 0;
  }

  command(args, { timeoutMs = 5000, signal } = {}) {
    const deadline = this.clock.now() + timeoutMs;
    const operation = this.tail.then(async () => {
      signal?.throwIfAborted();
      const waiting = Math.max(0, this.nextAt - this.clock.now());
      if (waiting) await this.clock.sleep(waiting, signal);
      signal?.throwIfAborted();
      const remaining = deadline - this.clock.now();
      if (remaining <= 0)
        throw new DOMException(
          "Fly command admission timed out",
          "TimeoutError",
        );
      this.nextAt = this.clock.now() + 1100;
      const cmd = args
        .map((value) => "'" + value.replaceAll("'", "'\"'\"'") + "'")
        .join(" ");
      if (new TextEncoder().encode(cmd).length > 12000)
        throw nodeExecutionError("input_limit");
      const response = await this.request(
        "POST",
        `${this.path}/exec`,
        { cmd, timeout: Math.max(1, Math.ceil(remaining / 1000)) },
        { timeoutMs: Math.min(15000, remaining), signal },
      );
      signal?.throwIfAborted();
      if (!response.ok) throw nodeExecutionError("runtime_unavailable");
      const { data } = response;
      if (
        (data?.exit_code ?? 0) !== 0 ||
        (data?.exit_signal ?? 0) !== 0 ||
        typeof data?.stdout !== "string"
      )
        throw nodeExecutionError("execution_failed");
      if (new TextEncoder().encode(data.stdout).length > 160 * 1024)
        throw nodeExecutionError("output_limit");
      return data.stdout;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  async bridge(mode, signal) {
    if (!["ready", "execute"].includes(mode))
      throw nodeExecutionError("invalid_input");
    const raw = await this.command(
      ["node", "/runtime/transport.mjs", `--${mode}`],
      { signal },
    );
    return readFlyReply(raw, mode, signal);
  }
}

/** The host checks transport shape and decoded reply bytes outside generated code. */
export async function readFlyReply(raw, mode, signal) {
  let reply;
  try {
    reply = JSON.parse(raw);
  } catch {
    throw nodeExecutionError("invalid_reply");
  }
  if (mode === "ready" && [503, 504].includes(reply?.status))
    throw nodeExecutionError("startup_pending");
  if (reply?.status === 504) throw nodeExecutionError("timeout");
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
    signal ?? new AbortController().signal,
  );
}
