import { HttpError } from "../../http.js";

/** Verify exact raw bytes using Svix's documented HMAC protocol before interpreting provider data. */
export async function verifyResendWebhook(secret, body, headers, now) {
  try {
    const { id, timestamp, signature } = headers;
    if (
      !/^msg_[A-Za-z0-9_-]{1,100}$/.test(id) ||
      !/^\d{1,12}$/.test(timestamp) ||
      Math.abs(now / 1000 - Number(timestamp)) > 300 ||
      typeof signature !== "string" ||
      signature.length > 2048 ||
      !/^whsec_[A-Za-z0-9+/=]+$/.test(secret)
    )
      throw new Error("Invalid signature metadata.");
    const bytes = Uint8Array.from(atob(secret.slice(6)), (char) =>
      char.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
    let valid = false;
    for (const value of signature.split(" ").slice(0, 10)) {
      if (!value.startsWith("v1,")) continue;
      try {
        if (
          await crypto.subtle.verify(
            "HMAC",
            key,
            Uint8Array.from(atob(value.slice(3)), (char) => char.charCodeAt(0)),
            signed,
          )
        )
          valid = true;
      } catch {
        /* Unsupported signatures cannot authorize this event. */
      }
    }
    if (!valid) throw new Error("Signature mismatch.");
    const event = JSON.parse(body),
      at = Date.parse(event.created_at);
    if (
      !/^[a-f0-9-]{36}$/.test(event.data?.email_id) ||
      !Number.isFinite(at) ||
      at > now + 300000 ||
      typeof event.type !== "string"
    )
      throw new Error("Invalid event.");
    return {
      eventId: id,
      emailId: event.data.email_id,
      event: event.type.replace(/^email\./, ""),
      at,
    };
  } catch {
    throw new HttpError(401, "Invalid email provider signature or event.");
  }
}
