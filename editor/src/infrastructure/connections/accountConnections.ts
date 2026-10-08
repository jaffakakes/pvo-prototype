import {
  parseConnectionMetadata,
  parseConnectionSetup,
  type ConnectionMetadata,
  type ConnectionSetup,
} from "../../../../packages/pvo-assistant/connections/index.js";
import {
  parseTaskRecord,
  TASK_LIMITS,
  type TaskRecord,
} from "../../../../packages/pvo-assistant/tasks/index.js";
import { readAssistantJson } from "../assistant/serviceResponse";

export type AccountConnection = {
  connection: ConnectionMetadata;
  scope: ConnectionSetup;
  account: string;
  expiresAt: number | null;
  checkedAt: number;
};
function detail(value: unknown): AccountConnection {
  if (!value || typeof value !== "object")
    throw new Error("Connection status could not be read. Refresh and retry.");
  const data = value as Record<string, unknown>;
  if (
    typeof data.account !== "string" ||
    !Number.isSafeInteger(data.checkedAt) ||
    (data.expiresAt !== null && !Number.isSafeInteger(data.expiresAt))
  )
    throw new Error("Connection status could not be read. Refresh and retry.");
  return {
    connection: parseConnectionMetadata(data.connection),
    scope: parseConnectionSetup(data.scope),
    account: data.account,
    checkedAt: data.checkedAt as number,
    expiresAt: data.expiresAt as number | null,
  };
}
async function request(
  action: string,
  body: unknown,
  signal: AbortSignal,
  ownerId: string,
): Promise<Record<string, unknown>> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(35000)]);
  const response = await fetch(`/api/account-connections${action}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: combined,
    headers: {
      Accept: "application/json",
      "X-Restyle-Owner": ownerId,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401
        ? "Sign in again to manage connections."
        : response.status === 403
          ? "The account changed. Reopen your account before retrying."
          : response.status === 409
            ? "Access or saved progress changed. Refresh, then reconnect or continue."
            : response.status === 400
              ? "Check the repository name and fine-grained token."
              : response.status === 429
                ? "The connection limit was reached. Try again later."
                : "Account setup could not finish. Refresh to check whether it was saved, then retry.",
    );
  }
  const value = await readAssistantJson(
    response,
    combined,
    action === "/attach" ? TASK_LIMITS.recordBytes + 1024 : 64 * 1024,
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The server returned an unreadable connection status.");
  return value as Record<string, unknown>;
}
export async function listAccountConnections(
  ownerId: string,
  after: string | null,
  signal: AbortSignal,
) {
  const data = await request(
    after ? `?after=${encodeURIComponent(after)}` : "",
    undefined,
    signal,
    ownerId,
  );
  if (
    !Array.isArray(data.items) ||
    data.items.length > 4 ||
    typeof data.available !== "boolean" ||
    (data.next !== null && typeof data.next !== "string")
  )
    throw new Error("The server returned an unreadable connection list.");
  return {
    items: data.items.map(detail),
    next: data.next as string | null,
    available: data.available,
  };
}
export async function connectAccount(
  ownerId: string,
  id: string,
  expectedRevision: number,
  setup: ConnectionSetup,
  token: string,
  signal: AbortSignal,
) {
  return detail(
    await request(
      "/connect",
      { id, expectedRevision, setup, token },
      signal,
      ownerId,
    ),
  );
}
export async function controlAccountConnection(
  ownerId: string,
  action: "check" | "disconnect",
  connection: ConnectionMetadata,
  signal: AbortSignal,
) {
  return detail(
    await request(
      `/${action}`,
      { id: connection.id, expectedRevision: connection.revision },
      signal,
      ownerId,
    ),
  );
}
export async function attachAccountConnection(
  ownerId: string,
  id: string,
  task: TaskRecord,
  questionId: string,
  operationId: string,
  signal: AbortSignal,
) {
  const result = parseTaskRecord(
    (
      await request(
        "/attach",
        {
          id,
          taskId: task.id,
          expectedRevision: task.revision,
          questionId,
          operationId,
        },
        signal,
        ownerId,
      )
    ).task,
  );
  if (
    result.id !== task.id ||
    result.ownerId !== task.ownerId ||
    result.input.projectId !== task.input.projectId
  )
    throw new Error(
      "The connection belongs to different saved work. Refresh this task.",
    );
  return result;
}
