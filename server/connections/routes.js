import { getAccountSession } from "../auth/sessions.js";
import { checkOrigin, HttpError, json, readJson } from "../http.js";
import { connectionCommand } from "./input.js";

export const isAccountConnectionRoute = (path) =>
  path === "/api/account-connections" ||
  path.startsWith("/api/account-connections/");
export async function accountConnectionRoute(request, env, config) {
  const url = new URL(request.url);
  if (
    config.origin !== url.origin ||
    typeof env.ASSISTANT_TASKS?.getByName !== "function"
  )
    throw new HttpError(503, "Account connections are unavailable.");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new HttpError(400, "Account connections require a secure origin.");
  const list = url.pathname === "/api/account-connections";
  const match =
    /^\/api\/account-connections\/(connect|check|disconnect|attach|invoke)$/.exec(
      url.pathname,
    );
  if (!list && !match)
    throw new HttpError(404, "This connection operation is unavailable.");
  if (request.method !== (list ? "GET" : "POST"))
    throw new HttpError(
      405,
      "This connection operation uses a different request method.",
    );
  if (!list) checkOrigin(request, config.origin);
  if (
    list
      ? [...url.searchParams.keys()].some(
          (key) => key !== "after" || url.searchParams.getAll(key).length !== 1,
        )
      : url.search
  )
    throw new HttpError(
      400,
      "This connection operation does not accept those query fields.",
    );
  const owner = await getAccountSession(request, env);
  if (!owner)
    throw new HttpError(401, "Sign in to manage private account connections.");
  if (request.headers.get("X-Restyle-Owner") !== owner.id)
    throw new HttpError(
      403,
      "The signed-in account changed. Reopen your account before retrying.",
    );
  const kind = list ? "list" : match[1];
  const input = connectionCommand(
    kind,
    list
      ? { after: url.searchParams.get("after") }
      : await readJson(request, 4096),
  );
  let result;
  try {
    result = await env.ASSISTANT_TASKS.getByName(
      `owner:${owner.id}`,
    ).manageConnections(owner.id, { kind, input });
  } catch {
    throw new HttpError(
      503,
      "Account connections could not respond. Refresh and retry.",
    );
  }
  if (!result.ok) throw new HttpError(result.status, result.error);
  return json(result.value);
}
