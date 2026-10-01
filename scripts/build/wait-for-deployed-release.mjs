const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 1_000;
const MAX_REQUEST_MS = 10_000;

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function exactHttpsOrigin(value) {
  const origin = new URL(value);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Release verification requires an exact HTTPS deployment origin.");
  }
  return origin;
}

export function validateEditorReleaseRevision(revision) {
  if (
    typeof revision !== "string" ||
    !/^restyle-editor-shell-[a-f0-9]{16}$/.test(revision)
  ) {
    throw new Error("Release publishing requires a valid editor revision.");
  }
  return revision;
}

/** Wait for Cloudflare's deployed asset manifest to serve the expected release. */
export async function waitForDeployedRelease({
  origin,
  revision,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = Date.now,
  sleep = delay,
}) {
  const base = exactHttpsOrigin(origin);
  validateEditorReleaseRevision(revision);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new Error("Release verification timeout must be between 1 and 120000 milliseconds.");
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > timeoutMs) {
    throw new Error("Release verification interval must fit within its timeout.");
  }

  const deadline = now() + timeoutMs;
  let attempt = 0;
  let lastResult = "no response";
  while (now() < deadline) {
    const remaining = deadline - now();
    const controller = new AbortController();
    let timer;
    const requestTimeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("request timed out"));
      }, Math.max(1, Math.min(MAX_REQUEST_MS, remaining)));
    });
    const url = new URL("/editor/release.json", base);
    url.searchParams.set("expected", revision);
    url.searchParams.set("attempt", String(++attempt));
    try {
      const response = await Promise.race([
        fetchImpl(url, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache, no-store, max-age=0",
            Pragma: "no-cache",
          },
          redirect: "error",
          signal: controller.signal,
        }),
        requestTimeout,
      ]);
      if (!response.ok) {
        lastResult = `HTTP ${response.status}`;
      } else {
        const body = await response.text();
        if (body.length > 1_024) throw new Error("release response is too large");
        const served = JSON.parse(body);
        lastResult = typeof served?.revision === "string"
          ? `served ${served.revision}`
          : "missing revision";
        if (served?.revision === revision) return { revision, attempts: attempt };
      }
    } catch (error) {
      lastResult = error instanceof Error ? error.message : "request failed";
    } finally {
      clearTimeout(timer);
      controller.abort();
    }

    const waitMs = Math.min(intervalMs, Math.max(0, deadline - now()));
    if (waitMs > 0) await sleep(waitMs);
  }
  throw new Error(
    `Deployment finished but ${revision} was not served within ${timeoutMs}ms (${lastResult}). No release announced.`,
  );
}

/** Announce only after the deployed Worker and its ASSETS binding agree on the release. */
export async function announceDeployedRelease({
  origin,
  revision,
  secret,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = Date.now,
  sleep = delay,
}) {
  const base = exactHttpsOrigin(origin);
  validateEditorReleaseRevision(revision);
  if (typeof secret !== "string" || !secret) {
    throw new Error("Release announcement requires its configured secret.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new Error("Release announcement timeout must be between 1 and 120000 milliseconds.");
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > timeoutMs) {
    throw new Error("Release announcement interval must fit within its timeout.");
  }

  const deadline = now() + timeoutMs;
  let attempt = 0;
  let lastResult = "no response";
  while (now() < deadline) {
    const remaining = deadline - now();
    const controller = new AbortController();
    let timer;
    let terminalError;
    const requestTimeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("request timed out"));
      }, Math.max(1, Math.min(MAX_REQUEST_MS, remaining)));
    });
    try {
      const response = await Promise.race([
        fetchImpl(new URL("/api/releases/announce", base), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ revision }),
          redirect: "error",
          signal: controller.signal,
        }),
        requestTimeout,
      ]);
      if (response.ok) return { revision, attempts: ++attempt };
      attempt += 1;
      lastResult = `HTTP ${response.status}`;
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 409 &&
        response.status !== 429
      ) {
        terminalError = new Error(
          `Deployment is live but its release announcement was rejected (${response.status}).`,
        );
      }
    } catch (error) {
      attempt += 1;
      lastResult = error instanceof Error ? error.message : "request failed";
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    if (terminalError) throw terminalError;

    const waitMs = Math.min(intervalMs, Math.max(0, deadline - now()));
    if (waitMs > 0) await sleep(waitMs);
  }
  throw new Error(
    `Deployment may be live, but ${revision} was not announced within ${timeoutMs}ms (${lastResult}).`,
  );
}
