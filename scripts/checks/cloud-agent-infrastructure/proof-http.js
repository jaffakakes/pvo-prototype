export const limits = Object.freeze({
  artifactBytes: 64 * 1024,
  requestBytes: 4096,
  responseBytes: 4096,
  calls: 20,
  cpuMs: 50,
  commandMs: 15_000,
  workspaceMs: 60_000,
});

export function authorize(request, env) {
  if (
    !env.PROOF_TOKEN ||
    !env.PROOF_ID ||
    !Number.isSafeInteger(Number(env.PROOF_EXPIRES_AT))
  ) {
    return new Response("Proof is not configured", { status: 503 });
  }
  if (request.headers.get("Authorization") !== `Bearer ${env.PROOF_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (
    Date.now() >= Number(env.PROOF_EXPIRES_AT) &&
    request.method !== "DELETE"
  ) {
    return new Response("Proof has expired", { status: 410 });
  }
  return null;
}

export function mark(response, env) {
  response = new Response(response.body, response);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Restyle-Proof", env.PROOF_ID);
  return response;
}

export async function readBounded(stream, maximum) {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error("byte_limit");
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
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function digest(source) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
