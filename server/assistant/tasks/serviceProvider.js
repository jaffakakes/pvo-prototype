import { parseServiceObservation } from "../../../packages/pvo-assistant/releases/index.js";

// Cloudflare RPC adds a disposal symbol even to plain data. Consume the wire data
// at this adapter boundary, then release the RPC result on success or rejection.
async function observation(call, identity) {
  const result = await call;
  try {
    const { [Symbol.dispose]: dispose, ...data } = result;
    return parseServiceObservation(data, identity);
  } finally {
    result?.[Symbol.dispose]?.();
  }
}

/** Private Cloudflare binding, selected from saved identity rather than model URLs. */
export function serviceProvider(env) {
  if (typeof env.SERVICE_RELEASES?.getByName !== "function") return null;
  const stub = (identity) =>
    env.SERVICE_RELEASES.getByName(identity.resourceId);
  return {
    publish(publication) {
      return observation(
        stub(publication.identity).publish(publication),
        publication.identity,
      );
    },
    lookup(identity) {
      return observation(stub(identity).lookup(identity), identity);
    },
    cancel(identity) {
      return observation(stub(identity).cancel(identity), identity);
    },
  };
}
