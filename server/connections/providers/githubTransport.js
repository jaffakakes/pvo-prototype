import { HttpError } from "../../http.js";
import { GitHubAccessError } from "./githubErrors.js";
const API = "https://api.github.com";
const MAX_BYTES = 256 * 1024;
function beforeDeadline(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Provider deadline"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          void value?.body?.cancel().catch(() => {});
          reject(new Error("Provider deadline"));
        } else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** Only trusted adapters construct paths. Credentials remain outside generated execution. */
export function githubTransport(fetcher = fetch, timeoutMs = 10000) {
  async function request(path, token, options = {}) {
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await beforeDeadline(
        fetcher(`${API}${path}`, {
          method: options.method ?? "GET",
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
          redirect: "manual",
          signal,
          headers: {
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "Restyle-account-connections",
          },
        }),
        signal,
      );
    } catch {
      throw new HttpError(
        503,
        "GitHub could not be reached. Retry this read later.",
      );
    }
    if (response.status !== (options.method === "POST" ? 201 : 200)) {
      await response.body?.cancel();
      if (
        response.status === 429 ||
        response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")
      )
        throw new HttpError(
          429,
          "GitHub is limiting requests. Try again later.",
        );
      if ([401, 403, 404].includes(response.status))
        throw new GitHubAccessError();
      throw new HttpError(
        503,
        "GitHub did not return a usable response. Recheck the repository and retry.",
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(503, "GitHub returned an empty response.");
    let size = 0,
      chunks = [];
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await beforeDeadline(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("Response limit");
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const raw = new TextDecoder().decode(bytes);
      if (raw.includes(token)) throw new Error("Reflected credential");
      const value = JSON.parse(raw);
      if (JSON.stringify(value).includes(token))
        throw new Error("Reflected credential");
      const expiry = Date.parse(
        response.headers.get("github-authentication-token-expiration") ?? "",
      );
      return { value, expiresAt: Number.isFinite(expiry) ? expiry : null };
    } catch {
      throw new HttpError(
        503,
        "GitHub returned data that Restyle could not safely read.",
      );
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return request;
}
