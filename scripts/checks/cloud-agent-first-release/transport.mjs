import { setTimeout as pause } from "node:timers/promises";

function replayable(path, method, body) {
  if (method === "GET") return true;
  if (method !== "POST") return false;
  if (/^\/(dinner|equipment)\/command$/.test(path))
    return (
      body?.kind === "answers" && typeof body.input?.operationId === "string"
    );
  if (!/^\/(dinner|equipment)\/api$/.test(path)) return false;
  if (body?.method === "GET") return true;
  if (body?.method !== "POST") return false;
  return (
    (body.path === "/api/assistant/projects" &&
      typeof body.body?.localId === "string") ||
    (body.path === "/api/assistant/tasks" &&
      typeof body.body?.operationId === "string") ||
    (/^\/api\/services\/[^/]+\/activate$/.test(body.path) &&
      typeof body.body?.operationId === "string")
  );
}

/** Retry only reads and exact idempotent intents; a server update must not discard the paid test. */
export function acceptanceTransport(
  send,
  {
    expiresAt,
    signal,
    record = async () => {},
    now = Date.now,
    wait = (milliseconds) => pause(milliseconds, undefined, { signal }),
  },
) {
  return async (path, method = "GET", body, authenticated = true) => {
    const intent = body === undefined ? undefined : structuredClone(body);
    const safe = replayable(path, method, intent);
    let attempt = 0;
    while (now() < expiresAt) {
      signal?.throwIfAborted();
      let response;
      try {
        response = await send(
          path,
          method,
          structuredClone(intent),
          authenticated,
        );
      } catch (error) {
        signal?.throwIfAborted();
        if (!safe) throw error;
      }
      const status =
        response?.status === 200 && /^\/(dinner|equipment)\/api$/.test(path)
          ? response.data?.status
          : response?.status;
      if (response && (!safe || ![502, 503, 504].includes(status)))
        return response;
      attempt++;
      await record("diagnostic_transport_recovery", {
        path,
        method,
        attempt,
        status: status ?? null,
        ...(path === "/health" && response?.data?.startup
          ? { startup: response.data.startup }
          : {}),
      });
      const remaining = expiresAt - now();
      if (remaining <= 0) break;
      await wait(Math.min(remaining, attempt < 5 ? 2000 : 15000));
    }
    throw new Error(
      `Diagnostic deadline ended while recovering ${method} ${path}.`,
    );
  };
}

/** Startup uses the same bounded recovery as subsequent read-only calls. */
export async function acceptanceReady(
  call,
  proofId,
  {
    expiresAt = Date.now() + 30000,
    signal,
    record = async () => {},
    now = Date.now,
    wait = (milliseconds) => pause(milliseconds, undefined, { signal }),
  } = {},
) {
  let response;
  do {
    signal?.throwIfAborted();
    response = await call("/health");
    // A newly created workers.dev route can still return the platform's 404.
    // Only wait for propagation when there is no application identity at all.
    if (response.status !== 404 || response.marker != null) break;
    await record("diagnostic_route_propagation", { status: response.status });
    const remaining = expiresAt - now();
    if (remaining <= 0) break;
    await wait(Math.min(2000, remaining));
  } while (now() < expiresAt);
  if (
    response.status !== 200 ||
    response.marker !== proofId ||
    response.data?.ready !== true
  )
    throw new Error(
      `The approved diagnostic did not become ready (HTTP ${response.status}, matching identity: ${response.marker === proofId}).`,
    );
}
