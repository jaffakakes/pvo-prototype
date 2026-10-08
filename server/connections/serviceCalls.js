import {
  object,
  id,
  integer,
} from "../../packages/pvo-assistant/tasks/validation.js";
import {
  parseConnectionAdapter,
  parseAdapterInput,
  adapterPolicy,
} from "../../packages/pvo-assistant/connections/index.js";
import { canonicalJson } from "../../packages/pvo-assistant/services/json.js";
import { contentDigest } from "../contentDigest.js";
import { HttpError } from "../http.js";
import { ConnectionAccessError } from "./accessError.js";
import { AccountRequestStore } from "./requestStore.js";

const pending = () =>
  new HttpError(
    409,
    "This outside action needs checking. Check its existing result; do not send a new request.",
  );
function serviceId(value) {
  if (!/^service-[a-f0-9]{64}$/.test(value ?? ""))
    throw new HttpError(400, "Invalid Container reference.");
}
function permitted(manager, input) {
  manager.expire();
  const current = manager.get(input.connectionId),
    adapter = parseConnectionAdapter(input.adapter);
  if (current.connection.status !== "connected")
    throw new ConnectionAccessError();
  if (
    current.connection.provider !== adapter.provider ||
    !current.connection.permissions.includes(adapter.permission)
  )
    throw new HttpError(
      403,
      "This account has not approved the requested permission.",
    );
  return { current, adapter };
}

/** Called only by the trusted Container/account adapters; never accepts a URL or private headers. */
export async function accountServiceCommand(coordinator, ownerId, kind, input) {
  id(ownerId, "Account owner");
  coordinator.repository.bindOwner(ownerId);
  const manager = coordinator.accountConnections;
  if (kind === "service_forget") {
    object(input, ["serviceId"], "Retired service");
    serviceId(input.serviceId);
    new AccountRequestStore(coordinator.ctx.storage.sql).forgetCompleted(
      input.serviceId,
    );
    return { removedCompleted: true };
  }
  const checking = kind === "service_check";
  object(
    input,
    checking
      ? ["connectionId", "adapter"]
      : ["serviceId", "actionId", "index", "connectionId", "adapter", "input"],
    "Container account call",
  );
  id(input.connectionId, "Account connection");
  const { current, adapter } = permitted(manager, input);
  if (checking)
    return {
      ...manager.public(current),
      adapterDigest: await contentDigest(canonicalJson(adapter)),
    };
  serviceId(input.serviceId);
  id(input.actionId, "Service action");
  integer(input.index, 3, "Account request step");
  parseAdapterInput(adapter, input.input);
  const token = await manager.secret(ownerId, current);
  manager.expire();
  manager.same(current.id, current.revision);
  const provider = coordinator.connectionProvider().service;
  if (!provider)
    throw new HttpError(503, "Connected Container actions are unavailable.");
  if (adapterPolicy(adapter).effect === "read") {
    try {
      const result = await provider.invoke(
        current.details.scope,
        token,
        adapter,
        input.input,
        null,
      );
      manager.expire();
      manager.same(current.id, current.revision);
      return { result };
    } catch (error) {
      if (
        error instanceof ConnectionAccessError &&
        manager.catalog.get(current.id)?.revision === current.revision
      )
        manager.invalidate(current, "expired");
      throw error;
    }
  }
  const key = await contentDigest(
    canonicalJson({
      ownerId,
      serviceId: input.serviceId,
      actionId: input.actionId,
      index: input.index,
    }),
  );
  const fingerprint = await contentDigest(
    canonicalJson({
      connectionId: input.connectionId,
      adapter,
      input: input.input,
    }),
  );
  manager.expire();
  manager.same(current.id, current.revision);
  const store = new AccountRequestStore(coordinator.ctx.storage.sql);
  let receipt = store.get(key);
  if (receipt && receipt.fingerprint !== fingerprint)
    throw new HttpError(
      409,
      "This action identity already belongs to a different outside request.",
    );
  if (receipt?.status === "completed") return { result: receipt.result };
  const inspecting = Boolean(receipt);
  if (
    inspecting &&
    adapter.provider === "resend" &&
    receipt.providerIdentity !== current.details.accountId
  )
    throw pending();
  if (!receipt) {
    receipt = {
      id: key,
      serviceId: input.serviceId,
      actionId: input.actionId,
      index: input.index,
      connectionId: input.connectionId,
      fingerprint,
      providerIdentity: current.details.accountId,
      adapter,
      input: input.input,
      status: "dispatching",
      result: null,
      createdAt: coordinator.now(),
      checkedAt: null,
    };
    // This synchronous commit precedes every possible provider write, including the first await.
    store.save(receipt);
  }
  try {
    const result = inspecting
      ? await provider.inspect(
          current.details.scope,
          token,
          adapter,
          input.input,
          key,
          current.details.login,
          { createdAt: receipt.createdAt, now: coordinator.now() },
        )
      : await provider.invoke(
          current.details.scope,
          token,
          adapter,
          input.input,
          key,
        );
    const latest = store.get(key);
    if (latest.status === "completed") {
      manager.expire();
      manager.same(current.id, current.revision);
      return { result: latest.result };
    }
    if (result === null) {
      if (latest.status !== "completed")
        store.save({
          ...latest,
          status: "needs_checking",
          checkedAt: coordinator.now(),
        });
      throw pending();
    }
    store.save({
      ...latest,
      status: "completed",
      result,
      checkedAt: coordinator.now(),
    });
    manager.expire();
    manager.same(current.id, current.revision);
    return { result };
  } catch (error) {
    const latest = store.get(key);
    if (latest?.status !== "completed")
      store.save({
        ...latest,
        status: "needs_checking",
        checkedAt: coordinator.now(),
      });
    if (
      error instanceof ConnectionAccessError &&
      manager.catalog.get(current.id)?.revision === current.revision
    )
      manager.invalidate(current, "expired");
    throw pending();
  }
}
