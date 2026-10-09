import { identityResource } from "../../packages/pvo-assistant/identity/index.js";
import {
  identityTransport,
  IdentityProviderError,
} from "../agent-identity/transport.js";
import { mailbox } from "./verificationRules.js";

function messageText(value, max) {
  if (typeof value !== "string" || value.length > max)
    throw new IdentityProviderError(503, "uncertain");
  return value;
}
function time(value) {
  const result = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isSafeInteger(result))
    throw new IdentityProviderError(503, "uncertain");
  return result;
}

/** Private bounded reads from the saved inbox/number only. Raw messages never leave this adapter. */
export function verificationMessages(provider, fetcher = fetch) {
  return async (
    { resourceId, recipient, startedAt, expiresAt, plan },
    token,
  ) => {
    const deadlineAt = Date.now() + 10000;
    const request = (path) => {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) throw new IdentityProviderError(503, "uncertain");
      return identityTransport(provider, fetcher, remaining)(path, { token });
    };
    identityResource(resourceId);
    const query = new URLSearchParams({
      limit: "50",
      after: new Date(startedAt).toISOString(),
      before: new Date(expiresAt).toISOString(),
    });
    if (provider === "agentmail") {
      for (const field of [
        "include_spam",
        "include_blocked",
        "include_unauthenticated",
        "include_trash",
      ])
        query.set(field, "false");
    }
    const base =
      provider === "agentmail"
        ? `/v0/inboxes/${encodeURIComponent(resourceId)}/messages`
        : `/v1/numbers/${encodeURIComponent(resourceId)}/messages`;
    const result = await request(`${base}?${query}`);
    const raw = provider === "agentmail" ? result.messages : result.data;
    if (
      !Array.isArray(raw) ||
      raw.length > 50 ||
      (provider === "agentmail" ? result.next_page_token : result.hasMore)
    )
      throw new IdentityProviderError(503, "verification_page_incomplete");
    const messages = [];
    for (const entry of raw) {
      if (
        provider === "agentmail" &&
        (mailbox(entry.from) !== plan.sender.toLowerCase() ||
          !Array.isArray(entry.to) ||
          entry.to.length !== 1 ||
          mailbox(entry.to[0]) !== recipient ||
          entry.subject !== plan.subject)
      )
        continue;
      const messageId = messageText(
        provider === "agentmail" ? entry.message_id : entry.id,
        512,
      );
      if (!messageId || /[\x00-\x1f\x7f]/.test(messageId))
        throw new IdentityProviderError(503, "uncertain");
      const value =
        provider === "agentmail"
          ? await request(`${base}/${encodeURIComponent(messageId)}`)
          : entry;
      if (provider === "agentmail") {
        if (
          value.inbox_id !== resourceId ||
          value.message_id !== entry.message_id ||
          !Array.isArray(value.to) ||
          value.to.length !== 1 ||
          !Array.isArray(value.labels) ||
          value.labels.some((label) =>
            [
              "spam",
              "blocked",
              "unauthenticated",
              "trash",
              "sent",
              "draft",
            ].includes(label),
          )
        )
          continue;
        messages.push({
          id: messageId,
          sender: mailbox(value.from),
          recipient: mailbox(value.to[0]),
          subject: messageText(value.subject ?? "", 500),
          body: messageText(value.text ?? "", 16384),
          receivedAt: time(value.created_at),
        });
      } else {
        if (
          value.direction !== "inbound" ||
          value.channel !== "sms" ||
          value.to !== recipient
        )
          continue;
        messages.push({
          id: messageId,
          sender: messageText(value.from_, 32),
          recipient: value.to,
          subject: null,
          body: messageText(value.body, 16384),
          receivedAt: time(value.receivedAt),
        });
      }
    }
    return messages;
  };
}
