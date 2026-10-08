import {
  parseConnectionSetup,
  parseConnectionAdapter,
  parseAdapterInput,
  projectAdapterResult,
  parseResendCredential,
} from "../../../packages/pvo-assistant/connections/index.js";
import { resendTransport } from "./resendTransport.js";
import { contentDigest } from "../../contentDigest.js";

/** Fixed Resend origin, plain text only, creator-selected addresses and a 23-hour recovery window. */
export function resendAdapter(fetcher = fetch, timeoutMs = 10000) {
  const request = resendTransport(fetcher, timeoutMs);
  async function send(scope, credential, raw, input, key) {
    scope = parseConnectionSetup(scope);
    const adapter = parseConnectionAdapter(raw);
    if (
      scope.provider !== "resend" ||
      adapter.provider !== "resend" ||
      !/^[a-f0-9]{64}$/.test(key)
    )
      throw new Error("Invalid email connection.");
    input = parseAdapterInput(adapter, input);
    return projectAdapterResult(
      adapter,
      await request("/emails", credential, {
        idempotencyKey: key,
        body: {
          from: scope.from,
          to: [scope.recipient],
          subject: input.subject,
          text: input.text,
        },
      }),
    );
  }
  return {
    async verify(raw, credential) {
      const scope = parseConnectionSetup(raw);
      if (scope.provider !== "resend") throw new Error("Invalid email scope.");
      await request("/emails?limit=1", credential);
      return {
        accountId: await contentDigest(parseResendCredential(credential).key),
        login: scope.from,
        expiresAt: null,
        scope,
      };
    },
    service: {
      invoke: send,
      async inspect(scope, credential, adapter, input, key, account, context) {
        if (!context || context.now - context.createdAt >= 23 * 3600000)
          return null;
        return send(scope, credential, adapter, input, key);
      },
      async status(scope, credential, emailId) {
        if (!/^[a-f0-9-]{36}$/.test(emailId))
          throw new Error("Invalid provider receipt.");
        const result = await request(`/emails/${emailId}`, credential);
        if (result.id !== emailId) throw new Error("Provider receipt changed.");
        return { id: emailId, event: result.last_event };
      },
    },
  };
}
