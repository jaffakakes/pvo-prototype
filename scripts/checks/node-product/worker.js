import {
  authorize,
  mark,
  readBounded,
} from "../cloud-agent-infrastructure/proof-http.js";
import {
  hostedServiceRoute,
  isServiceRoute,
} from "../../../server/cloud-services/routes.js";
import {
  assistantTaskRoute,
  isTaskRoute,
} from "../../../server/assistant/tasks/routes.js";
import { signCookie } from "../../../server/auth/tokens.js";
import { productOwner } from "./tasks.js";
export { ProductControl, ProductNode } from "./control.js";
export { ProductHost } from "./host.js";
export { ProductTasks } from "./tasks.js";

/** Synthetic account bridge exercises real HTTP boundaries without production accounts or session secrets. */
async function api(env, { path, method = "GET", body, foreign = false }) {
  const origin = env.PUBLIC_ORIGIN,
    url = new URL(path, origin);
  if (
    url.origin !== origin ||
    !path.startsWith("/api/") ||
    (!isServiceRoute(url.pathname) && !isTaskRoute(url.pathname)) ||
    !["GET", "POST"].includes(method)
  )
    throw new Error("Invalid diagnostic API request");
  const owner = {
    id: foreign ? `other-${env.PROOF_ID}` : productOwner(env),
    name: "Node acceptance",
  };
  const cookie = await signCookie(
    { token: "node-product" },
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
  const response = await (
    isServiceRoute(url.pathname) ? hostedServiceRoute : assistantTaskRoute
  )(request, configured, { origin });
  return { status: response.status, body: await response.json() };
}

export default {
  async fetch(request, env) {
    const { pathname, origin } = new URL(request.url);
    const publicAction =
      /^\/api\/services\/service-[a-f0-9]{64}\/actions$/.test(pathname);
    if (!publicAction) {
      const denied = authorize(request, env);
      if (denied) return mark(denied, env);
    }
    const control = env.PROOF_CONTROL.getByName("global");
    try {
      if (request.method === "DELETE" && pathname === "/") {
        await control.close();
        const slots = [];
        for (let i = 0; i < 2; i++)
          slots.push(
            await env.SERVICE_NODE_EXECUTION.getByName(`slot-${i}`).dispose(),
          );
        return mark(Response.json({ slots }), env);
      }
      if (!(await control.allow()))
        return mark(
          new Response("Diagnostic admission closed", { status: 410 }),
          env,
        );
      if (publicAction) return hostedServiceRoute(request, env, { origin });
      const task = env.ASSISTANT_TASKS.getByName(`owner:${productOwner(env)}`);
      const input =
        request.method === "POST"
          ? JSON.parse((await readBounded(request.body, 1152 * 1024)) || "{}")
          : {};
      let result;
      if (pathname === "/health") result = { ready: true };
      else if (pathname === "/begin") result = await task.begin();
      else if (pathname === "/status") result = await task.snapshot();
      else if (pathname === "/reconcile") result = await task.reconcile();
      else if (pathname === "/version")
        result = await task.version(input.variant);
      else if (pathname === "/api") result = await api(env, input);
      else if (pathname === "/usage") result = await control.snapshot();
      else if (pathname === "/slots") {
        result = [];
        for (let i = 0; i < 2; i++)
          result.push(
            await env.SERVICE_NODE_EXECUTION.getByName(
              `slot-${i}`,
            ).diagnostic(),
          );
      } else if (pathname === "/node" && [0, 1].includes(input.slot)) {
        const slot = env.SERVICE_NODE_EXECUTION.getByName(`slot-${input.slot}`);
        if (input.action === "restart") result = await slot.restart();
        else if (input.action === "expire") result = await slot.expireLease();
        else throw new Error("Unknown Node diagnostic");
      } else if (pathname === "/host") {
        const { row } = await task.snapshot();
        const host = env.SERVICE_HOSTS.getByName(row.identity.serviceId);
        if (input.action === "restart") result = await host.restart();
        else if (input.action === "sweep") result = await host.sweep(input.at);
        else if (input.action === "probe")
          result = await host.probe(row.identity, {
            operation: "join",
            input: { name: "Probe" },
          });
        else result = await host.diagnostic();
      } else return mark(new Response("Not found", { status: 404 }), env);
      return mark(Response.json(result), env);
    } catch (error) {
      let message = String(error.message);
      for (const [key, value] of Object.entries(env))
        if (/TOKEN|SECRET|KEY/.test(key) && typeof value === "string" && value)
          message = message.replaceAll(value, "[redacted]");
      return mark(
        Response.json(
          { error: "diagnostic_interrupted", message: message.slice(0, 512) },
          { status: 503 },
        ),
        env,
      );
    }
  },
};
