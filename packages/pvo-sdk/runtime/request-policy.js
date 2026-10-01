import { RequestPolicyError } from "./request-failure.js";

export function checkedRequestUrl(value, allowedDomains) {
  if (typeof value !== "string") throw new RequestPolicyError("Request URL must be an absolute HTTP(S) URL.");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new RequestPolicyError("Request URL must be an absolute HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new RequestPolicyError("Request URL must be an absolute HTTP(S) URL without credentials.");
  }
  const allowed = Array.isArray(allowedDomains) ? allowedDomains : [];
  if (!allowed.some((domain) => typeof domain === "string" && domain.toLowerCase() === parsed.host.toLowerCase())) {
    throw new RequestPolicyError(`Request domain ${parsed.host} is not in allowed_domains.`);
  }
  return parsed.href;
}
