import { getAccountSession } from "../auth/sessions.js";
import { checkOrigin, HttpError, json, readJson } from "../http.js";

export const isAgentIdentityRoute = (path) =>
  path === "/api/agent-identity" || path.startsWith("/api/agent-identity/");

/** Authenticated human setup only; a model or generated service cannot select another owner. */
export async function agentIdentityRoute(request, env, config) {
  const url = new URL(request.url);
  if (
    config.origin !== url.origin ||
    typeof env.ASSISTANT_TASKS?.getByName !== "function"
  )
    throw new HttpError(503, "Agent identity setup is unavailable.");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new HttpError(400, "Private setup requires a secure connection.");
  const list = url.pathname === "/api/agent-identity";
  const match =
    /^\/api\/agent-identity\/(start|verify|resend|import|discover|check|disconnect)$/.exec(
      url.pathname,
    );
  if (!list && !match)
    throw new HttpError(404, "This identity action is unavailable.");
  if (url.search || request.method !== (list ? "GET" : "POST"))
    throw new HttpError(400, "This identity request is unavailable.");
  if (!list) checkOrigin(request, config.origin);
  const owner = await getAccountSession(request, env);
  if (!owner)
    throw new HttpError(401, "Sign in to manage your agent identity.");
  if (request.headers.get("X-Restyle-Owner") !== owner.id)
    throw new HttpError(403, "Your account changed. Reopen private setup.");
  const input = list ? null : await readJson(request, 4096);
  let result;
  try {
    result = await env.ASSISTANT_TASKS.getByName(
      `owner:${owner.id}`,
    ).manageIdentity(owner.id, { kind: list ? "list" : match[1], input });
  } catch {
    throw new HttpError(
      503,
      "Identity setup could not respond. Refresh its saved status.",
    );
  }
  if (!result.ok) throw new HttpError(result.status, result.error);
  return json(result.value);
}
