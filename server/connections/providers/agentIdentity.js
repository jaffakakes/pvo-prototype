import { identityProvider } from "../../agent-identity/providers.js";
import { IdentityProviderError } from "../../agent-identity/transport.js";
import { ConnectionAccessError } from "../accessError.js";
import { parseConnectionSetup } from "../../../packages/pvo-assistant/connections/index.js";

/** Resource-scoped identity connections cannot read an entire account or issue arbitrary calls. */
export function agentIdentityAdapter(provider, fetcher) {
  const api = identityProvider(provider, fetcher);
  return {
    async verify(raw, token) {
      const scope = parseConnectionSetup(raw);
      if (scope.provider !== provider)
        throw new Error("Identity scope changed.");
      try {
        return await api.inspect(scope.resourceId, token);
      } catch (error) {
        if (
          error instanceof IdentityProviderError &&
          [401, 403, 404].includes(error.providerStatus)
        )
          throw new ConnectionAccessError();
        throw error;
      }
    },
  };
}
