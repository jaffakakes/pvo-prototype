import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "./worker-bundle.helpers.mjs";

export const ASSISTANT_ORIGIN = "https://assistant.example";
export const assistantInput = () => ({
  componentType: "card",
  source: { structure: '<card><title>A weekend away</title><body>Choose your adventure.</body><button id="next">Continue</button></card>',
    style: "card { background: #ffffff; }", logic: "on press(next) { continue(); }" },
  prompt: "Give this a warm sunset palette and clearer title",
  context: { currentSceneId: "main", duration: 6, scenes: [{ id: "main", name: "Main" }, { id: "next", name: "Next" }] },
});
export const assistantDraft = () => ({
  source: { ...assistantInput().source, structure: assistantInput().source.structure.replace("A weekend away", "Your next adventure"),
    style: "card { background: #fff0d9; border-radius: 24px; } title { color: #8a341c; font-size: 28px; } #next { background: #e49b54; }" },
  summary: "Added a warm sunset palette and a clearer heading.",
  tags: ["Warm palette", "Clearer heading"],
  followUps: ["Make the heading more playful", "Use a cooler palette", "Round the button corners"],
});

let modules;
export async function assistantFixture({ outputs = [assistantDraft()], allow = () => true, available = true } = {}) {
  modules ??= bundleWorkerModules({ stdin: { resolveDir: process.cwd(), contents: `
    import { handleRequest } from "./server/index.js";
    export default { fetch(request, env) {
      const AI = env.AI_AVAILABLE ? { async run(model, input, options) {
        const response = await env.MODEL.fetch(new Request("https://model.test/", { method: "POST",
          body: JSON.stringify({ model, input }), signal: options.signal }));
        if (!response.ok) throw new Error("private provider error");
        return response.json();
      } } : undefined;
      const ASSISTANT_BUDGET = {
        getByName(name) {
          return {
            async reserve(key) {
              return (await env.QUOTA.fetch(new Request("https://quota.test/", { method: "POST", body: JSON.stringify({name,key}) }))).json();
            }
          };
        }
      };
      return handleRequest(request, { ...env, AI, ASSISTANT_BUDGET });
    } };
  ` } });
  const calls = [];
  const reservations = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "assistant-route-test", modules: await modules,
    compatibilityDate: "2026-09-27", bindings: { PUBLIC_ORIGIN: ASSISTANT_ORIGIN, AI_AVAILABLE: available },
    serviceBindings: {
      MODEL: async request => {
        calls.push(await request.json());
        const value = outputs[calls.length - 1];
        if (value instanceof Response) return value;
        return Response.json({ response: value });
      },
      QUOTA: async request => {
        reservations.push(await request.json());
        return Response.json(allow(reservations.length));
      },
    },
  }));
  return { calls, reservations, close: () => mf.dispose(),
    request: (body = assistantInput(), options = {}) => mf.dispatchFetch(`${ASSISTANT_ORIGIN}/api/assistant`, {
      method: "POST", body: JSON.stringify(body), ...options,
      headers: { "Content-Type": "application/json", Origin: ASSISTANT_ORIGIN, "CF-Connecting-IP": "192.0.2.1", ...options.headers },
    }),
  };
}
