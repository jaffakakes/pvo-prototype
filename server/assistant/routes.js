import { parseAssistantRequest } from "../../packages/pvo-assistant/index.js";
import { compilePvoComponent } from "../../packages/pvo-language/worker.js";
import { checkOrigin, HttpError, json, readJson } from "../http.js";
import { reserveAssistantUsage } from "./quota.js";
import { runAssistantModel } from "./model.js";
import { proposeAssistantChange } from "./service.js";

export async function assistantRoute(request, env, config) {
  if (request.method !== "POST") throw new HttpError(405, "Send a proposal request from the editor.");
  const origin = new URL(request.url).origin;
  if (!config.origin || config.origin !== origin)
    throw new HttpError(503, "The assistant is unavailable. Please try again later.");
  checkOrigin(request, origin);
  if (typeof env.AI?.run !== "function" || !env.ASSISTANT_BUDGET)
    throw new HttpError(503, "The assistant is unavailable. Please try again later.");
  const body = await readJson(request, 96 * 1024);
  let input;
  try {
    input = parseAssistantRequest(body);
  } catch {
    throw new HttpError(400, "Send a valid component and editing request.");
  }
  // Leave room in the model context for instructions, output and one compiler repair.
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 16 * 1024)
    throw new HttpError(413, "This component is too large for the assistant. Shorten its source and try again.");
  const proposal = await proposeAssistantChange(input, {
    compile: compilePvoComponent,
    reserve: () => reserveAssistantUsage(request, env),
    run: (messages, signal) => runAssistantModel(env.AI, messages, signal),
    signal: request.signal,
  });
  return json(proposal);
}
