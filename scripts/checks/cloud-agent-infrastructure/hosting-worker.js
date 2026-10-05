// Disposable, fixed fixture for Roadmap 1A. This is not a creator-code runtime.
export default {
  async fetch(request, env) {
    const response = handleRequest(request, env);
    response.headers.set("Cache-Control", "no-store");
    if (env.PROOF_ID) response.headers.set("X-Restyle-Proof", env.PROOF_ID);
    return response;
  },
};

function handleRequest(request, env) {
  const expiresAt = Number(env.PROOF_EXPIRES_AT);
  if (
    !env.PROOF_TOKEN ||
    !env.PROOF_ID ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0
  ) {
    return new Response("Proof is not configured", { status: 503 });
  }
  if (request.headers.get("Authorization") !== `Bearer ${env.PROOF_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (Date.now() >= expiresAt)
    return new Response("Proof has expired", { status: 410 });
  if (new URL(request.url).pathname !== "/proof")
    return new Response("Not found", { status: 404 });
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }
  return Response.json(
    { proofId: env.PROOF_ID, runtime: "cloudflare-worker", answer: 6 * 7 },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
