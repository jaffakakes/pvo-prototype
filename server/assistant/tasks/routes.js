import { taskStorageAvailable } from "./availability.js";
import { TASK_LIMITS } from "../../../packages/pvo-assistant/tasks/index.js";
import { getAccountSession } from "../../auth/sessions.js";
import { checkOrigin, HttpError, json, readJson } from "../../http.js";
import {
  creationInput,
  creatorCommand,
  projectInput,
  taskId,
  taskListInput,
} from "./input.js";

export function isTaskRoute(path) {
  return (
    path === "/api/assistant/projects" ||
    path === "/api/assistant/tasks" ||
    path.startsWith("/api/assistant/tasks/")
  );
}

export async function assistantTaskRoute(request, env, config) {
  const url = new URL(request.url);
  if (!taskStorageAvailable(env, config, url.origin))
    throw new HttpError(
      503,
      "Saved assistant tasks are unavailable. Please try again later.",
    );
  if (request.method !== "GET") checkOrigin(request, config.origin);
  const owner = await getAccountSession(request, env);
  if (!owner)
    throw new HttpError(401, "Sign in to build or manage a cloud component.");
  const operation = await taskOperation(request, url);
  let result;
  try {
    result = await env.ASSISTANT_TASKS.getByName(`owner:${owner.id}`).execute(
      owner.id,
      operation,
    );
  } catch {
    throw new HttpError(
      503,
      "Saved assistant tasks are unavailable. Please try again later.",
    );
  }
  if (result.error) throw new HttpError(result.status, result.error);
  if (operation.kind === "result")
    return new Response(result.body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  return json(result, result.created ? 201 : 200);
}

async function taskOperation(request, url) {
  const path = url.pathname;
  if (path === "/api/assistant/tasks" && request.method === "GET") {
    taskListInput(url.searchParams);
    return { kind: "list", query: url.search };
  }
  if (url.search)
    throw new HttpError(
      400,
      "This task operation does not accept query fields.",
    );
  if (path === "/api/assistant/projects" && request.method === "POST")
    return {
      kind: "project",
      input: projectInput(await readJson(request, 1024)),
    };
  if (path === "/api/assistant/tasks" && request.method === "POST")
    return {
      kind: "create",
      input: creationInput(await readJson(request, TASK_LIMITS.inputBytes)),
    };
  const match =
    /^\/api\/assistant\/tasks\/([A-Za-z0-9_-]{1,128})(?:\/(answers|resume|stop|manual|result|tests))?$/.exec(
      path,
    );
  if (match) {
    taskId(match[1]);
    if (["result", "tests"].includes(match[2]) && request.method === "GET")
      return { kind: match[2], id: match[1] };
    if (!match[2] && request.method === "GET")
      return { kind: "read", id: match[1] };
    if (
      ["answers", "resume", "stop", "manual"].includes(match[2]) &&
      request.method === "POST"
    ) {
      const input = await readJson(request, 8192);
      creatorCommand(match[2], input);
      return { kind: match[2], id: match[1], input };
    }
  }
  throw new HttpError(404, "This task operation is unavailable.");
}
