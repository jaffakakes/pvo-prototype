import {
  object,
  choice,
  text,
  id,
  integer,
  requireTask,
} from "../../packages/pvo-assistant/tasks/validation.js";
import { identityEmail } from "../../packages/pvo-assistant/identity/index.js";

const phoneSender = (value) =>
  /^(?:\+[1-9][0-9]{7,14}|[0-9]{5,6})$/.test(value);

/** Only a trusted service adapter supplies this policy; it is never a model inbox query. */
export function verificationPlan(value) {
  object(
    value,
    [
      "service",
      "operationId",
      "provider",
      "sender",
      "subject",
      "prefix",
      "digits",
      "expiresAt",
    ],
    "Verification plan",
  );
  id(value.service, "Service");
  id(value.operationId, "Setup operation");
  choice(value.provider, ["agentmail", "agentphone"], "Identity provider");
  if (value.provider === "agentmail") identityEmail(value.sender);
  else
    requireTask(
      typeof value.sender === "string" && phoneSender(value.sender),
      "Invalid verification sender.",
    );
  text(value.prefix, 200, "Code prefix");
  requireTask(
    value.prefix.trim().length > 3,
    "A specific code prefix is required.",
  );
  integer(value.digits, 10, "Code length", 4);
  integer(value.expiresAt, Number.MAX_SAFE_INTEGER, "Verification expiry", 1);
  if (value.provider === "agentmail")
    text(value.subject, 300, "Expected subject");
  else requireTask(value.subject === null, "SMS has no subject.");
  return structuredClone(value);
}

export function mailbox(value) {
  if (typeof value !== "string" || value.length > 500 || /[\r\n]/.test(value))
    return null;
  const address = value.includes("<")
    ? /^[^<>]*<([^<>]+)>$/.exec(value)?.[1]
    : value;
  try {
    return identityEmail(address);
  } catch {
    return null;
  }
}

/** Exact scope/time/subject matching, then literal extraction; message text cannot change the plan. */
export function matchVerification(messages, attempt, now) {
  if (now >= attempt.plan.expiresAt) return { status: "expired" };
  const { plan, recipient, startedAt, baseline } = attempt;
  const candidates = [];
  const seen = new Set();
  for (const message of messages) {
    if (baseline.includes(message.id)) continue;
    if (seen.has(message.id)) return { status: "ambiguous" };
    seen.add(message.id);
    if (
      message.sender !== plan.sender.toLowerCase() ||
      message.recipient !== recipient ||
      message.subject !== plan.subject ||
      message.receivedAt < startedAt ||
      message.receivedAt >= plan.expiresAt ||
      message.receivedAt > now
    )
      continue;
    const proofs = [];
    let cursor = 0;
    while ((cursor = message.body.indexOf(plan.prefix, cursor)) !== -1) {
      cursor += plan.prefix.length;
      const part = message.body.slice(cursor);
      const match = new RegExp(`^([0-9]{${plan.digits}})(?![0-9])`).exec(part);
      if (match) proofs.push(match[1]);
    }
    if (proofs.length > 1) return { status: "ambiguous" };
    if (proofs.length === 1)
      candidates.push({ code: proofs[0], messageId: message.id });
  }
  if (candidates.length > 1) return { status: "ambiguous" };
  return candidates.length
    ? { status: "ready", proof: candidates[0] }
    : { status: "waiting" };
}
