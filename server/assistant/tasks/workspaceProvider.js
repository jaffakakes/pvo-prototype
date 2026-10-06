import {
  parseWorkspaceObservation,
  parseWorkspaceReceipt,
  serializeWorkspaceRequest,
} from "../../../packages/pvo-assistant/workspaces/index.js";
import { contentDigest } from "../../contentDigest.js";

async function consume(call, parse) {
  const result = await call;
  try {
    if (result === null) return parse(null);
    const { [Symbol.dispose]: dispose, ...data } = result;
    return parse(data);
  } finally {
    result?.[Symbol.dispose]?.();
  }
}

/** Trusted private binding. The model cannot supply its resource identity or execution grant. */
export function workspaceProvider(env) {
  if (
    typeof env.ASSISTANT_WORKSPACES?.getByName !== "function" ||
    typeof env.WORKSPACE_BUDGET?.getByName !== "function"
  )
    return null;
  const stub = (identity) =>
    env.ASSISTANT_WORKSPACES.getByName(identity.resourceId);
  const observe = (identity, call) =>
    consume(call, (value) => parseWorkspaceObservation(value, identity));
  return {
    async operate(identity, kind, request, grant) {
      const digest = await contentDigest(
        serializeWorkspaceRequest(kind, request),
      );
      const method = kind === "command" ? "execute" : kind;
      return consume(
        stub(identity)[method](identity, request, grant),
        (value) => {
          const receipt = parseWorkspaceReceipt(value);
          if (
            receipt.id !== request.id ||
            receipt.kind !== kind ||
            receipt.digest !== digest
          )
            throw new Error("Workspace receipt does not match its request.");
          return receipt;
        },
      );
    },
    receipt(identity, id) {
      return consume(stub(identity).receipt(identity, id), (value) => {
        if (value === null) return null;
        const receipt = parseWorkspaceReceipt(value);
        if (receipt.id !== id)
          throw new Error(
            "Workspace receipt belongs to a different operation.",
          );
        return receipt;
      });
    },
    lookup(identity) {
      return observe(identity, stub(identity).lookup(identity));
    },
    suspend(identity, generation) {
      return observe(identity, stub(identity).suspend(identity, generation));
    },
    stop(identity) {
      return observe(identity, stub(identity).stop(identity));
    },
  };
}
