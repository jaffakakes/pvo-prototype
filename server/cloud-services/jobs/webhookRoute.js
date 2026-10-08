import { HttpError, json } from "../../http.js";

const pattern =
  /^\/api\/services\/(service-[a-f0-9]{64})\/resend\/([A-Za-z0-9_-]{1,128})$/;

/** A signature, rather than a creator session or a secret URL, authorizes provider callbacks. */
export async function serviceWebhookRoute(request, env) {
  const target = pattern.exec(new URL(request.url).pathname);
  if (!target) return null;
  if (request.method !== "POST") throw new HttpError(405, "Use POST.");
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0] !== "application/json"
  )
    throw new HttpError(415, "Send application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing provider event.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new HttpError(413, "Provider event is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const result = await env.SERVICE_HOSTS.getByName(target[1]).providerEvent(
    target[1],
    target[2],
    body,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
  );
  try {
    if (!result.ok) throw new HttpError(result.status, result.error);
    return json(result.value);
  } finally {
    result?.[Symbol.dispose]?.();
  }
}
