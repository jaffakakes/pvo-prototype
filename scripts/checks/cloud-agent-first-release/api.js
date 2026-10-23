import { signCookie } from "../../../server/auth/tokens.js";
import {
  assistantTaskRoute,
  isTaskRoute,
} from "../../../server/assistant/tasks/routes.js";
import {
  hostedServiceRoute,
  isServiceRoute,
} from "../../../server/cloud-services/routes.js";
import { proofOwner } from "./tasks.js";

/** Private diagnostic bridge: real routes with two synthetic accounts, no production login/database. */
export async function diagnosticApi(env, subject, { path, method, body }) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/api/") ||
    path.startsWith("//") ||
    !["GET", "POST", "OPTIONS"].includes(method)
  )
    throw new Error("Invalid diagnostic API request");
  const origin = env.PUBLIC_ORIGIN;
  const url = new URL(path, origin);
  if (
    url.origin !== origin ||
    (!isTaskRoute(url.pathname) && !isServiceRoute(url.pathname))
  )
    throw new Error("Unsupported diagnostic API route");
  const owner = { id: proofOwner(env, subject), name: `Acceptance ${subject}` };
  const cookie = await signCookie(
    { token: subject },
    env.PROOF_TOKEN,
    "session",
    120,
  );
  const request = new Request(url, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: `__Host-pvo-session=${cookie}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const configured = {
    ...env,
    SESSION_SECRET: env.PROOF_TOKEN,
    DB: { prepare: () => ({ bind: () => ({ first: async () => owner }) }) },
  };
  try {
    const response = await (
      isTaskRoute(url.pathname) ? assistantTaskRoute : hostedServiceRoute
    )(request, configured, { origin });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
    };
  } catch (error) {
    return {
      status: error.status ?? 503,
      body: { error: error.status ? error.message : "Diagnostic API failed" },
    };
  }
}
