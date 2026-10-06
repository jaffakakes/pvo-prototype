import { getAccountSession } from "../auth/sessions.js";
import { checkOrigin, HttpError, json, readJson } from "../http.js";
import { HOSTED_SERVICE_LIMITS } from "../../packages/pvo-assistant/hosting/index.js";

const servicePath =
  /^\/api\/services\/(service-[a-f0-9]{64})(?:\/(try|operate|actions|activate|pause|delete))?$/;
export const isServiceRoute = (path) =>
  path === "/api/services" || path.startsWith("/api/services/");
function cors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}
async function rpc(call) {
  let result;
  try {
    const raw = await call();
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
  return result.value;
}
export async function hostedServiceRoute(request, env, config) {
  const url = new URL(request.url),
    match = servicePath.exec(url.pathname),
    publicCall = match?.[2] === "actions",
    list = url.pathname === "/api/services";
  const finish = (response) => (publicCall ? cors(response) : response);
  try {
    if ((!match && !list) || url.search)
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
    const reading = list || !match?.[2];
    if (request.method !== (reading ? "GET" : "POST"))
      throw new HttpError(
        405,
        reading
          ? "This service operation requires GET."
          : "This service operation requires POST.",
      );
    let owner;
    if (!publicCall) {
      if (!reading) checkOrigin(request, config.origin);
      owner = await getAccountSession(request, env);
      if (!owner) throw new HttpError(401, "Sign in to manage this service.");
    }
    const kind = match?.[2],
      id = match?.[1];
    const input = reading
      ? null
      : await readJson(request, HOSTED_SERVICE_LIMITS.requestBytes);
    if (["try", "operate", "actions"].includes(kind)) {
      const authority = publicCall
        ? { kind: "public" }
        : {
            kind: "creator",
            ownerId: owner.id,
            mode: kind === "try" ? "test" : "live",
          };
      return finish(
        json(
          await rpc(() =>
            env.SERVICE_HOSTS.getByName(id).invoke(id, authority, input),
          ),
        ),
      );
    }
    if (typeof env.ASSISTANT_TASKS?.getByName !== "function")
      throw new HttpError(503, "Service management is unavailable.");
    if (!reading && input?.kind !== kind)
      throw new HttpError(
        400,
        "The service control does not match this operation.",
      );
    const operation = list
      ? { kind: "list" }
      : reading
        ? { kind: "read", id }
        : { kind: "control", id, input };
    const result = await rpc(() =>
      env.ASSISTANT_TASKS.getByName(`owner:${owner.id}`).manageServices(
        owner.id,
        operation,
      ),
    );
    if (result.control) {
      if (!result.control.ok)
        throw new HttpError(result.control.status, result.control.error);
      return json(result.control.value);
    }
    return json(result);
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
