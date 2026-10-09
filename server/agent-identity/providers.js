import {
  identityEmail,
  identityResource,
  identityCredential,
} from "../../packages/pvo-assistant/identity/index.js";
import { identityTransport, IdentityProviderError } from "./transport.js";

// A usable one-time key must reach encrypted storage even if companion metadata is malformed.
function optionalResource(value) {
  try {
    return identityResource(value);
  } catch {
    return null;
  }
}

/** Bootstrap produces private material for the trusted vault, never a model or public response. */
export function identityProvider(provider, fetcher = fetch) {
  const request = identityTransport(provider, fetcher);
  return {
    async discover(token) {
      identityCredential(token);
      const result = await request(
        provider === "agentmail"
          ? "/v0/inboxes?limit=50"
          : "/v1/numbers?offset=0",
        { token },
      );
      const items = provider === "agentmail" ? result.inboxes : result.data;
      if (!Array.isArray(items) || items.length > 50)
        throw new IdentityProviderError(503, "uncertain");
      const resources = items
        .filter((item) =>
          provider === "agentmail"
            ? item.status !== "paused"
            : !["released", "deleted", "suspended"].includes(item.status),
        )
        .map((item) => ({
          resourceId: identityResource(
            provider === "agentmail" ? item.inbox_id : item.id,
          ),
          address:
            provider === "agentmail"
              ? identityEmail(item.email)
              : item.phoneNumber,
        }));
      if (
        provider === "agentphone" &&
        resources.some((item) => !/^\+[1-9][0-9]{7,14}$/.test(item.address))
      )
        throw new IdentityProviderError(503, "uncertain");
      return {
        resources,
        more:
          provider === "agentmail"
            ? Boolean(result.next_page_token)
            : result.hasMore === true,
      };
    },
    async start({ humanEmail, name }) {
      const result = await request("/v0/agent/sign-up", {
        secretReply: true,
        body:
          provider === "agentmail"
            ? { human_email: humanEmail, username: name, source: "restyle" }
            : { human_email: humanEmail, agent_name: name },
      });
      if (provider === "agentmail")
        return {
          resourceId: optionalResource(result.inbox_id),
          accountId: optionalResource(result.organization_id),
          token: identityCredential(result.api_key),
          verificationId: null,
        };
      return {
        verificationId: identityResource(result.verification_id),
        token: null,
        resourceId: null,
        accountId: null,
      };
    },
    async resend(privateState) {
      if (provider === "agentphone") return this.start(privateState);
      await request("/v0/agent/human", {
        token: privateState.token,
        body: { human_email: privateState.humanEmail },
      });
      return privateState;
    },
    async verify(privateState, code) {
      const result = await request("/v0/agent/verify", {
        secretReply: provider === "agentphone",
        token: privateState.token,
        body:
          provider === "agentmail"
            ? { otp_code: code }
            : { verification_id: privateState.verificationId, otp_code: code },
      });
      if (provider === "agentmail") {
        if (result.verified !== true)
          throw new IdentityProviderError(503, "rejected");
        return privateState;
      }
      return {
        ...privateState,
        token: identityCredential(result.api_key),
        resourceId: optionalResource(result.number_id),
        accountId: optionalResource(result.account_id),
      };
    },
    async inspect(resourceId, token) {
      identityResource(resourceId);
      identityCredential(token);
      const result = await request(
        provider === "agentmail"
          ? `/v0/inboxes/${encodeURIComponent(resourceId)}`
          : `/v1/numbers/${encodeURIComponent(resourceId)}`,
        { token },
      );
      if (provider === "agentmail") {
        if (result.inbox_id !== resourceId || result.status === "paused")
          throw new IdentityProviderError(503, "rejected");
        return {
          scope: { provider, resourceId },
          accountId: identityResource(result.pod_id),
          login: identityEmail(result.email),
          expiresAt: null,
        };
      }
      if (
        result.id !== resourceId ||
        !/^\+[1-9][0-9]{7,14}$/.test(result.phoneNumber) ||
        ["released", "deleted", "suspended"].includes(result.status)
      )
        throw new IdentityProviderError(503, "rejected");
      return {
        scope: { provider, resourceId },
        accountId: resourceId,
        login: result.phoneNumber,
        expiresAt: null,
      };
    },
  };
}
