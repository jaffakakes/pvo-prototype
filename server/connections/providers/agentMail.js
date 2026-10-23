import {
  parseConnectionSetup,
  parseConnectionAdapter,
  parseAdapterInput,
  projectAdapterResult,
} from "../../../packages/pvo-assistant/connections/index.js";
import {
  identityCredential,
  identityResource,
} from "../../../packages/pvo-assistant/identity/index.js";
import {
  identityTransport,
  IdentityProviderError,
} from "../../agent-identity/transport.js";
import { contentDigest } from "../../contentDigest.js";
import { ConnectionAccessError } from "../accessError.js";
import { agentIdentityAdapter } from "./agentIdentity.js";

function senderCredential(raw) {
  const value = JSON.parse(raw);
  identityCredential(value.key);
  identityResource(value.inboxId);
  return value;
}
/** The saved identity fixes the inbox; the separate creator approval fixes the recipient. */
export function agentMailAdapter(fetcher = fetch, timeoutMs = 10000) {
  const identity = agentIdentityAdapter("agentmail", fetcher);
  const request = identityTransport("agentmail", fetcher, timeoutMs);
  async function send(rawScope, credential, rawAdapter, rawInput, key) {
    const scope = parseConnectionSetup(rawScope),
      adapter = parseConnectionAdapter(rawAdapter);
    if (
      scope.provider !== "agentmail" ||
      !("recipient" in scope) ||
      adapter.provider !== "agentmail" ||
      !/^[a-f0-9]{64}$/.test(key)
    )
      throw new Error("Invalid agent email connection.");
    const input = parseAdapterInput(adapter, rawInput),
      saved = senderCredential(credential);
    try {
      const result = await request(
        `/v0/inboxes/${encodeURIComponent(saved.inboxId)}/messages/send`,
        {
          token: saved.key,
          idempotencyKey: key,
          body: {
            to: [scope.recipient],
            subject: input.subject,
            text: input.text,
          },
        },
      );
      if (typeof result.message_id !== "string" || !result.message_id.length)
        throw new Error("Email receipt missing.");
      return projectAdapterResult(adapter, { id: result.message_id });
    } catch (error) {
      if (
        error instanceof IdentityProviderError &&
        [401, 403, 404].includes(error.providerStatus)
      )
        throw new ConnectionAccessError();
      throw error;
    }
  }
  return {
    async verify(raw, credential) {
      const scope = parseConnectionSetup(raw);
      if (!("recipient" in scope)) return identity.verify(scope, credential);
      const { key, inboxId } = senderCredential(credential);
      const verified = await identity.verify(
        { provider: "agentmail", resourceId: inboxId },
        key,
      );
      return {
        ...verified,
        scope,
        accountId: await contentDigest(JSON.stringify({ key, inboxId })),
      };
    },
    service: {
      invoke: send,
      async inspect(scope, credential, adapter, input, key, account, context) {
        // AgentMail retains an idempotency result for 24h. Leave a margin; never resend after expiry.
        if (!context || context.now - context.createdAt >= 23 * 3600000)
          return null;
        return send(scope, credential, adapter, input, key);
      },
    },
  };
}
