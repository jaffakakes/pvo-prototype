import {
  id,
  object,
  requireTask,
  boundedJson,
} from "../../packages/pvo-assistant/tasks/validation.js";
import { parseResendCredential } from "../../packages/pvo-assistant/connections/index.js";
import { verifyResendWebhook } from "./providers/resendWebhook.js";
import { ConnectionAccessError } from "./accessError.js";
import { AccountRequestStore } from "./requestStore.js";
import { contentDigest } from "../contentDigest.js";
import { canonicalJson } from "../../packages/pvo-assistant/services/json.js";
import { HttpError } from "../http.js";

/** Only trusted service RPC can request status or verify a callback; never exposes private credentials. */
export async function accountServiceEvent(coordinator, ownerId, kind, input) {
  coordinator.repository.bindOwner(ownerId);
  const manager = coordinator.accountConnections;
  manager.expire();
  if (kind === "service_event") {
    object(input, ["connectionId", "body", "headers"], "Provider event");
    boundedJson(input, 20000, "Provider event");
    id(input.connectionId, "Connection");
    const current = manager.get(input.connectionId);
    if (current.connection.provider !== "resend")
      throw new HttpError(404, "Unknown provider connection.");
    const credential = parseResendCredential(
      await manager.secret(ownerId, current),
    );
    const event = await verifyResendWebhook(
      credential.webhookSecret,
      input.body,
      input.headers,
      coordinator.now(),
    );
    manager.same(current.id, current.revision);
    return event;
  }
  object(
    input,
    ["serviceId", "actionId", "index", "connectionId", "emailId"],
    "Provider status",
  );
  for (const name of ["actionId", "connectionId"]) id(input[name], name);
  requireTask(
    /^service-[a-f0-9]{64}$/.test(input.serviceId) &&
      Number.isSafeInteger(input.index) &&
      input.index >= 0 &&
      input.index < 4,
    "Invalid action scope.",
  );
  const key = await contentDigest(
    canonicalJson({
      ownerId,
      serviceId: input.serviceId,
      actionId: input.actionId,
      index: input.index,
    }),
  );
  const receipt = new AccountRequestStore(coordinator.ctx.storage.sql).get(key);
  if (
    receipt?.status !== "completed" ||
    receipt.connectionId !== input.connectionId ||
    receipt.adapter.provider !== "resend" ||
    receipt.result?.id !== input.emailId
  )
    throw new HttpError(404, "Unknown owned provider receipt.");
  const current = manager.get(input.connectionId),
    token = await manager.secret(ownerId, current);
  let result;
  try {
    result = await coordinator
      .connectionProvider()
      .service.status(current.details.scope, token, input.emailId);
  } catch (error) {
    if (
      error instanceof ConnectionAccessError &&
      manager.catalog.get(current.id)?.revision === current.revision
    )
      manager.invalidate(current, "expired");
    throw error;
  }
  manager.same(current.id, current.revision);
  return { ...result, at: coordinator.now() };
}
