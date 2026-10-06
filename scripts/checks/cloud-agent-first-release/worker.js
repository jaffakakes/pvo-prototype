import { AssistantWorkspace } from "../../../server/assistant/workspaces/coordinator.js";
import {
  authorize,
  mark,
  readBounded,
} from "../cloud-agent-infrastructure/proof-http.js";
import { hostedServiceRoute } from "../../../server/cloud-services/routes.js";
import { proofOwner } from "./tasks.js";
import { scenarios } from "./scenarios.js";
export { AcceptanceTasks } from "./tasks.js";
export { AcceptanceControl } from "./control.js";
export { AssistantBudget } from "../../../server/assistant/budget.js";
export { WorkspaceBudget } from "../../../server/assistant/workspaces/budget.js";
export { HostedService } from "../../../server/cloud-services/host.js";

export class AcceptanceWorkspace extends AssistantWorkspace {
  isAbsent() {
    return this.provider().absent();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const publicAction =
      /^\/api\/services\/service-[a-f0-9]{64}\/actions$/.test(url.pathname);
    if (!publicAction) {
      const denied = authorize(request, env);
      if (denied) return mark(denied, env);
    }
    const ledger = env.PROOF_CONTROL.getByName("global");
    const tasks = (subject) =>
      env.ASSISTANT_TASKS.getByName(`owner:${proofOwner(env, subject)}`);
    try {
      if (request.method === "DELETE" && url.pathname === "/") {
        const stopped = [];
        for (const subject of Object.keys(scenarios))
          stopped.push(await tasks(subject).dispose(subject));
        return mark(
          Response.json({ stopped, usage: await ledger.report() }),
          env,
        );
      }
      if (!(await ledger.allow()))
        return mark(new Response("Acceptance has ended", { status: 429 }), env);
      if (publicAction)
        return hostedServiceRoute(request, env, { origin: url.origin });
      if (request.method === "GET" && url.pathname === "/health")
        return mark(Response.json({ ready: true }), env);
      if (request.method === "GET" && url.pathname === "/usage")
        return mark(Response.json(await ledger.report()), env);
      const [, subject, action] = url.pathname.split("/");
      if (!scenarios[subject])
        return mark(new Response(null, { status: 404 }), env);
      const stub = tasks(subject),
        ownerId = proofOwner(env, subject);
      let result;
      if (request.method === "GET" && action === "status")
        result = await stub.snapshot(subject);
      else if (request.method === "POST" && action === "begin")
        result = await stub.begin(subject);
      else if (request.method === "POST" && action === "restart")
        result = await stub.restart();
      else if (
        request.method === "POST" &&
        ["command", "manage"].includes(action)
      ) {
        const input = JSON.parse(await readBounded(request.body, 16384));
        result =
          action === "command"
            ? await stub.execute(ownerId, input)
            : await stub.manageServices(ownerId, input);
      } else return mark(new Response(null, { status: 404 }), env);
      return mark(Response.json(result), env);
    } catch {
      // Request bodies and provider exception text may contain private data.
      return mark(
        Response.json(
          { error: "acceptance_operation_failed" },
          { status: 503 },
        ),
        env,
      );
    }
  },
};
