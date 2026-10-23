import { setTimeout as delay } from "node:timers/promises";

/** Retry only a failed TLS handshake, before an HTTP request can reach Fly. Never retry unknown effects. */
export async function flyFetch(fetchImpl, url, options) {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await fetchImpl(url, options);
    } catch (error) {
      const beforeTls =
        error?.cause?.code === "ECONNRESET" &&
        error.cause.message ===
          "Client network socket disconnected before secure TLS connection was established";
      if (!beforeTls || attempt >= 2) throw error;
      await delay(100 * (attempt + 1), undefined, { signal: options.signal });
    }
  }
}
