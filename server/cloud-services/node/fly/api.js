import { nodeExecutionError } from "../protocol.js";

/** App-scoped Machine effects only. The product cannot manage organisations, tokens or other apps. */
export function flyMachineApi({ app, token, fetchImpl = fetch }) {
  if (
    typeof app !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(app) ||
    typeof token !== "string" ||
    !token.trim()
  )
    throw nodeExecutionError("runtime_unavailable");
  const root = `/apps/${app}/machines`;
  const single = new RegExp(`^${root}/[a-f0-9]{10,32}$`);
  const action = new RegExp(`^${root}/[a-f0-9]{10,32}/(?:start|exec)$`);
  const authorization = `${token.split(",").some((part) => /^(fm1r|fm2)_/.test(part)) ? "FlyV1" : "Bearer"} ${token}`;
  return async (method, path, body, { signal, timeoutMs = 15000 } = {}) => {
    const admitted =
      (method === "GET" && (path === root || single.test(path))) ||
      (method === "POST" && (path === root || action.test(path))) ||
      (method === "DELETE" &&
        path.endsWith("?force=true") &&
        single.test(path.slice(0, -11)));
    if (
      !admitted ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 15000
    )
      throw nodeExecutionError("invalid_input");
    const deadline = AbortSignal.timeout(timeoutMs);
    const current = signal ? AbortSignal.any([signal, deadline]) : deadline;
    current.throwIfAborted();
    // Never retry a create, start or execution after an unknown HTTP outcome.
    const response = await fetchImpl(`https://api.machines.dev/v1${path}`, {
      method,
      redirect: "manual",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: current,
    });
    // Workers supports manual redirects, not redirect:error. Never forward the app credential elsewhere.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw nodeExecutionError("runtime_unavailable");
    }
    const reader = response.body?.getReader();
    if (!reader)
      return { ok: response.ok, status: response.status, data: null };
    const parts = [];
    let length = 0;
    try {
      for (;;) {
        current.throwIfAborted();
        const { value, done } = await reader.read();
        current.throwIfAborted();
        if (done) break;
        length += value.byteLength;
        if (length > 2 * 1024 * 1024)
          throw nodeExecutionError("runtime_unavailable");
        parts.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      let data = null;
      try {
        if (length)
          data = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
      } catch {
        throw nodeExecutionError("runtime_unavailable");
      }
      // Status is available for reconciliation; private provider bodies never become user-facing errors.
      return { ok: response.ok, status: response.status, data };
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
}
