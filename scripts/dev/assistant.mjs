import { HttpError } from "../../server/http.js";
import { TRACKING_MAX_REQUEST_BYTES } from "../../packages/pvo-assistant/native/index.js";
import { json, failure } from "./http.mjs";
import { createLocalOriginPolicy } from "./local-origins.mjs";

const UPSTREAM = "https://getrestyle.app";
const MIB = 1024 * 1024;
const routes = new Map([
  ["/api/assistant/status", ["GET", 0]],
  ["/api/assistant/turn", ["POST", 3 * MIB]],
  ["/api/assistant/transcribe", ["POST", 2 * MIB]],
  ["/api/assistant/align", ["POST", 3 * MIB]],
  ["/api/assistant/track", ["POST", TRACKING_MAX_REQUEST_BYTES]],
  ["/api/web/search", ["GET", 0]],
  ["/api/web/read", ["GET", 0]],
  ["/api/fonts/search", ["GET", 0]],
  ["/api/fonts/download", ["GET", 0]],
  ["/api/fonts/import", ["POST", 8192]],
]);

function readBody(request, limit, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const finish = (error) => {
      request.off("data", data);
      request.off("end", end);
      request.off("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error) {
        request.resume();
        reject(error);
      } else resolve(Buffer.concat(chunks));
    };
    const data = (chunk) => {
      size += chunk.length;
      if (size > limit)
        finish(new HttpError(413, "This request is too large."));
      else chunks.push(chunk);
    };
    const end = () => finish();
    const failed = () =>
      finish(new HttpError(400, "Could not read this request."));
    const aborted = () => finish(signal.reason);
    if (Number(request.headers["content-length"]) > limit)
      return finish(new HttpError(413, "This request is too large."));
    if (signal.aborted) return aborted();
    request.on("data", data).once("end", end).once("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function readResponse(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing assistant response");
  const chunks = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * MIB) throw new Error("Assistant response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Forward foreground tools only; local account cookies never leave the beta. */
export function createLocalAssistantApi({
  origin,
  publicOrigin,
  fetcher = fetch,
  timeoutMs = 100000,
}) {
  const policy = createLocalOriginPolicy(origin, publicOrigin);
  return {
    handles: (pathname) => routes.has(pathname),
    async handle(request, response) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      const timer = setTimeout(cancel, timeoutMs);
      request.once("aborted", cancel);
      response.once("close", cancel);
      try {
        const url = new URL(request.url, origin);
        const route = routes.get(url.pathname);
        if (!route)
          throw new HttpError(404, "This assistant operation is unavailable.");
        if (request.method !== route[0])
          throw new HttpError(405, "This method is unavailable.");
        if (!policy.accepts(request))
          throw new HttpError(
            403,
            "This operation must start from the editor.",
          );
        if (request.url.length > 8192)
          throw new HttpError(414, "This address is too long.");
        const headers = {
          Accept: "application/json",
          Origin: UPSTREAM,
          "Sec-Fetch-Site": "same-origin",
        };
        let body;
        if (request.method === "POST") {
          const type =
            url.pathname === "/api/assistant/transcribe"
              ? "audio/wav"
              : "application/json";
          if (request.headers["content-type"]?.split(";", 1)[0].trim() !== type)
            throw new HttpError(415, `Send ${type}.`);
          headers["Content-Type"] = type;
          body = await readBody(request, route[1], controller.signal);
        }
        for (const name of [
          "x-audio-duration",
          "x-assistant-animation",
          "x-assistant-word-timing",
          "x-assistant-object-tracking",
        ]) {
          if (typeof request.headers[name] === "string")
            headers[name] = request.headers[name];
        }
        const upstream = await fetcher(
          `${UPSTREAM}${url.pathname}${url.search}`,
          {
            method: request.method,
            headers,
            body,
            redirect: "manual",
            signal: controller.signal,
          },
        );
        if (
          (upstream.status >= 300 && upstream.status < 400) ||
          upstream.headers.get("content-type")?.split(";", 1)[0].trim() !==
            "application/json"
        ) {
          await upstream.body?.cancel();
          throw new Error("Invalid assistant response");
        }
        const result = await readResponse(upstream, controller.signal);
        if (!response.destroyed) json(response, upstream.status, result);
      } catch (error) {
        if (!response.destroyed)
          failure(
            response,
            error instanceof HttpError ? error.status : 503,
            error instanceof HttpError
              ? error.message
              : "The assistant could not connect. Please try again.",
          );
      } finally {
        clearTimeout(timer);
        request.off("aborted", cancel);
        response.off("close", cancel);
      }
    },
  };
}
