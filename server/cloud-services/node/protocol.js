export const nodeExecutionError = (code) =>
  Object.assign(new Error(`Node execution ${code.replaceAll("_", " ")}.`), {
    code,
  });

/** Exact admitted payload; generated tests never enter hosted execution. */
export function nodeExecutionBody(bundle, invocation) {
  return JSON.stringify({
    bundle: {
      ...bundle,
      files: bundle.files.filter((file) => file.path.startsWith("src/")),
    },
    invocation,
  });
}

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
