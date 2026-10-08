import { platformOrigin } from "./policy.js";
import { object, id, requireTask } from "../tasks/validation.js";

/** One bearer link, held in the URL fragment so servers and referrers do not receive the private key. */
export function parseReceiptLink(value) {
  object(value, ["serviceId", "actionId", "receiptKey"], "Receipt link");
  requireTask(
    /^service-[a-f0-9]{64}$/.test(value.serviceId) &&
      /^[a-f0-9]{64}$/.test(value.receiptKey),
    "Invalid receipt link.",
  );
  id(value.actionId, "Receipt");
  return structuredClone(value);
}
export function serviceReceiptLink(saved) {
  requireTask(
    saved.target.mode === "public" &&
      saved.target.operation.delivery === "background",
    "This action has no background receipt.",
  );
  platformOrigin(saved.target.origin);
  const reference = parseReceiptLink({
    serviceId: saved.target.serviceId,
    actionId: saved.action.actionId,
    receiptKey: saved.receiptKey,
  });
  return `${saved.target.origin}/receipt.html#${encodeURIComponent(JSON.stringify(reference))}`;
}
