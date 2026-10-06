import { getAccountSession } from "../auth/sessions.js";
import { checkOrigin, HttpError, json, readJson } from "../http.js";
import { HOSTED_SERVICE_LIMITS } from "../../packages/pvo-assistant/hosting/index.js";

const servicePath = /^\/api\/services\/(service-[a-f0-9]{64})\/(try|actions)$/;
export const isServiceRoute = (path) =>
  path === "/api/services" || path.startsWith("/api/services/");
function cors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}
export async function hostedServiceRoute(request, env, config) {
  const url = new URL(request.url),
    match = servicePath.exec(url.pathname),
    publicCall = match?.[2] === "actions";
  const finish = (response) => (publicCall ? cors(response) : response);
  try {
    if (!match || url.search)
      throw new HttpError(404, "This service operation is unavailable.");
    if (
      config.origin !== url.origin ||
      typeof env.SERVICE_HOSTS?.getByName !== "function"
    )
      throw new HttpError(503, "Hosted services are unavailable.");
    if (publicCall && request.method === "OPTIONS")
      return finish(
        new Response(null, {
          status: 204,
          headers: { "Cache-Control": "no-store" },
        }),
      );
    if (request.method !== "POST")
      throw new HttpError(405, "This service operation requires POST.");
    let authority = { kind: "public" };
    if (!publicCall) {
      checkOrigin(request, config.origin);
      const owner = await getAccountSession(request, env);
      if (!owner) throw new HttpError(401, "Sign in to try this service.");
      authority = { kind: "creator", ownerId: owner.id, mode: "test" };
    }
    const input = await readJson(request, HOSTED_SERVICE_LIMITS.requestBytes);
    let result;
    try {
      const raw = await env.SERVICE_HOSTS.getByName(match[1]).invoke(
        match[1],
        authority,
        input,
      );
      try {
        const { [Symbol.dispose]: dispose, ...data } = raw;
        result = data;
      } finally {
        raw?.[Symbol.dispose]?.();
      }
    } catch {
      throw new HttpError(
        503,
        "This service could not respond. Retry the same action.",
      );
    }
    if (!result.ok) throw new HttpError(result.status, result.error);
    return finish(json(result.value));
  } catch (error) {
    return finish(
      json(
        {
          error:
            error instanceof HttpError
              ? error.message
              : "This service could not respond. Retry the same action.",
        },
        error instanceof HttpError ? error.status : 503,
      ),
    );
  }
}
