import {
  parseServicePackage,
  SERVICE_TEST_LIMITS as limits,
} from "../../packages/pvo-assistant/services/index.js";
import { withAssistantDeadline } from "../assistant/deadline.js";

function failure(code) {
  return Object.assign(
    new Error(`Service validation ${code.replaceAll("_", " ")}.`),
    { code },
  );
}

/** Only saved source modules enter the isolated runtime. Generated tests and expected replies stay outside. */
export function serviceWorkerCode(value) {
  const source = parseServicePackage(value);
  const entry = "__restyle_service_entry__.js";
  const modules = Object.fromEntries(
    source.files
      .filter((file) => file.path.startsWith("src/"))
      .map((file) => [file.path, { js: file.content }]),
  );
  modules[entry] = {
    js: `import { execute } from ${JSON.stringify("./" + source.entrypoint)};
export default { async fetch(request) { return Response.json(await execute(await request.json())); } };`,
  };
  return {
    compatibilityDate: "2026-10-03",
    compatibilityFlags: [],
    mainModule: entry,
    modules,
    env: {},
    globalOutbound: null,
    limits: { cpuMs: limits.cpuMs, subRequests: 0 },
  };
}

async function readReply(response, signal) {
  if (!response.ok) {
    await response.body?.cancel();
    throw failure("execution_failed");
  }
  if (Number(response.headers.get("Content-Length")) > limits.replyBytes) {
    await response.body?.cancel();
    throw failure("output_limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw failure("invalid_reply");
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > limits.replyBytes) {
        await reader.cancel();
        throw failure("output_limit");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const value of chunks) {
      bytes.set(value, offset);
      offset += value.length;
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw failure("invalid_reply");
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** A fresh Worker receives only this bounded invocation. It has no bindings, secrets, network or cached state. */
export async function executeServicePackage(
  loader,
  source,
  invocation,
  signal,
) {
  const body = JSON.stringify(invocation);
  if (
    typeof body !== "string" ||
    new TextEncoder().encode(body).length > limits.invocationBytes
  )
    throw failure("invalid_reply");
  const code = serviceWorkerCode(source);
  return withAssistantDeadline(
    async (current) => {
      current.throwIfAborted();
      const worker = loader.load(code);
      const response = await worker.getEntrypoint().fetch(
        new Request("https://service.invalid/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: current,
        }),
      );
      return readReply(response, current);
    },
    limits.invocationMs,
    signal,
  );
}
