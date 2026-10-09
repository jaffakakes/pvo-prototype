import { HttpError } from "../http.js";

export class IdentityProviderError extends HttpError {
  constructor(status, code, providerStatus = null) {
    super(
      status,
      "Agent identity setup needs attention. Refresh its saved status.",
    );
    this.code = code;
    this.providerStatus = providerStatus;
  }
}

async function deadline(promise, signal) {
  signal.throwIfAborted();
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(new Error("Identity provider deadline"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([promise, stopped]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Fixed provider origins, no redirects, bounded private replies, and no raw provider errors. */
export function identityTransport(
  provider,
  fetcher = fetch,
  timeoutMs = 10000,
) {
  const origin = {
    agentmail: "https://api.agentmail.to",
    agentphone: "https://api.agentphone.ai",
  }[provider];
  if (!origin) throw new Error("Identity provider is unavailable.");
  return async (path, { token = null, body, secretReply = false } = {}) => {
    if (!/^\/v[01]\/[A-Za-z0-9_/%@.+-]+(?:\?[A-Za-z0-9_=&.%+-]+)?$/.test(path))
      throw new Error("Invalid identity API path.");
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      const pending = Promise.resolve(
        fetcher(`${origin}${path}`, {
          method: body === undefined ? "GET" : "POST",
          redirect: "manual",
          signal,
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      // A transport which ignores cancellation must not retain a late response body.
      void pending.then(
        (value) => {
          if (signal.aborted) void value.body?.cancel().catch(() => {});
        },
        () => {},
      );
      response = await deadline(pending, signal);
    } catch {
      throw new IdentityProviderError(503, "uncertain");
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new IdentityProviderError(
        response.status === 429 ? 429 : 503,
        response.status === 409
          ? "existing_account"
          : [400, 401, 403, 422].includes(response.status)
            ? "rejected"
            : "uncertain",
        response.status,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new IdentityProviderError(503, "uncertain");
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      if (
        response.headers.get("Content-Type")?.split(";", 1)[0].trim() !==
        "application/json"
      )
        throw new Error("Unreadable identity response");
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await deadline(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > 65536) throw new Error("Identity response is too large");
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const result = JSON.parse(raw);
      if (
        !secretReply &&
        token &&
        (raw.includes(token) || JSON.stringify(result).includes(token))
      )
        throw new Error("Reflected private credential");
      return result;
    } catch {
      throw new IdentityProviderError(503, "uncertain");
    } finally {
      signal.removeEventListener("abort", cancel);
      cancel();
      reader.releaseLock();
    }
  };
}
