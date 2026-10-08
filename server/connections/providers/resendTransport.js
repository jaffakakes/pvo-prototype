import { HttpError } from "../../http.js";
import { ConnectionAccessError } from "../accessError.js";
import { parseResendCredential } from "../../../packages/pvo-assistant/connections/index.js";

function beforeDeadline(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Email provider deadline"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          void value?.body?.cancel().catch(() => {});
          reject(new Error("Email provider deadline"));
        } else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** Trusted callers supply fixed API paths. No redirect can forward the credential to another origin. */
export function resendTransport(fetcher, timeoutMs) {
  return async (path, credential, options = {}) => {
    const { key } = parseResendCredential(credential),
      signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await beforeDeadline(
        fetcher(`https://api.resend.com${path}`, {
          method: options.body ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            ...(options.idempotencyKey
              ? { "Idempotency-Key": options.idempotencyKey }
              : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          redirect: "manual",
          signal,
        }),
        signal,
      );
    } catch {
      throw new HttpError(
        503,
        "The email provider could not confirm this request.",
      );
    }
    if (!response.ok) {
      const status = response.status;
      void response.body?.cancel().catch(() => {});
      if ([401, 403].includes(status)) throw new ConnectionAccessError();
      throw Object.assign(
        new HttpError(
          status === 429 ? 429 : 503,
          "The email provider could not confirm this request.",
        ),
        { providerStatus: status },
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new HttpError(503, "The email provider returned no result.");
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      if (
        response.headers.get("Content-Type")?.split(";", 1)[0].trim() !==
        "application/json"
      )
        throw new Error("Invalid content type");
      const chunks = [];
      let size = 0;
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await beforeDeadline(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > 65536) throw new Error("Email provider result too large");
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (raw.includes(key)) throw new Error("Reflected credential");
      const value = JSON.parse(raw);
      if (JSON.stringify(value).includes(key))
        throw new Error("Reflected credential");
      return value;
    } catch {
      throw new HttpError(
        503,
        "The email provider returned data that could not be safely read.",
      );
    } finally {
      signal.removeEventListener("abort", cancel);
      cancel();
      reader.releaseLock();
    }
  };
}
