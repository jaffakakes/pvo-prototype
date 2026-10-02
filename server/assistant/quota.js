import { HttpError } from "../http.js";

/** Reserve one bounded provider-backed assistant request without retaining its address. */
export async function reserveAssistantUsage(request, env) {
  if (!env.ASSISTANT_BUDGET) throw new HttpError(503, "The assistant is unavailable. Please try again later.");
  const address = request.headers.get("CF-Connecting-IP");
  if (!address) throw new HttpError(503, "The assistant is unavailable. Please try again later.");
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${day}:${address}`));
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  let accepted;
  try {
    accepted = await env.ASSISTANT_BUDGET.getByName(`assistant:${day}`).reserve(key);
  } catch {
    throw new HttpError(503, "The assistant is unavailable. Please try again later.");
  }
  if (!accepted) throw new HttpError(429, "The assistant has reached its usage limit. Please try again later.");
}
