import { settleJob } from "./index.js";

export const providerComplete = (state) =>
  ["delivered", "bounced", "failed", "suppressed", "complained"].includes(
    state,
  );
const failed = (state) =>
  ["bounced", "failed", "suppressed", "complained"].includes(state);

/** Provider evidence moves forward only. A late send acknowledgement cannot undo delivery or failure. */
export function applyProviderUpdate(
  job,
  connectionId,
  emailId,
  event,
  at,
  now,
) {
  const receipts = job.providerReceipts.map((receipt) => {
    if (
      receipt.connectionId !== connectionId ||
      receipt.id !== emailId ||
      providerComplete(receipt.state) ||
      at < receipt.updatedAt
    )
      return receipt;
    if (
      ![
        "sent",
        "queued",
        "delivery_delayed",
        "delivered",
        "bounced",
        "failed",
        "suppressed",
        "complained",
      ].includes(event)
    )
      return receipt;
    return {
      ...receipt,
      state: event === "sent" ? "accepted" : event,
      updatedAt: at,
    };
  });
  let next = { ...job, providerReceipts: receipts, updatedAt: now };
  if (!job.executionDone) return next;
  if (receipts.some((receipt) => failed(receipt.state)))
    return settleJob(next, "failed", "provider_failed", now, job.result);
  if (
    receipts.length &&
    receipts.every((receipt) => receipt.state === "delivered")
  )
    return settleJob(next, "confirmed", null, now, job.result);
  return next;
}

export function mergeProviderReceipts(previous, incoming) {
  return incoming
    .map((receipt) => {
      const saved = previous.find((item) => item.index === receipt.index);
      if (!saved) return receipt;
      if (
        saved.id !== receipt.id ||
        saved.connectionId !== receipt.connectionId
      )
        throw new Error("Provider receipt changed.");
      return providerComplete(saved.state) ||
        saved.updatedAt >= receipt.updatedAt
        ? saved
        : receipt;
    })
    .concat(
      previous.filter(
        (saved) => !incoming.some((item) => item.index === saved.index),
      ),
    );
}

export function settleProviderEvidence(job, now) {
  return applyProviderUpdate(job, "", "", "", 0, now);
}
