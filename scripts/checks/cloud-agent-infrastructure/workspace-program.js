// Fixed infrastructure fixture. Restyle's model-driven code generation is Roadmap 1C.
const service = `export default {
  async fetch(request, env = {}) {
    const path = new URL(request.url).pathname;
    if (path === "/spin") { while (true) {} }
    if (path === "/oversize") return new Response("x".repeat(4097));
    if (path === "/network") {
      let blocked = false;
      try { await fetch("https://example.com"); } catch { blocked = true; }
      return Response.json({ blocked });
    }
    const input = await request.json();
    return Response.json({ answer: input.value * 2, credentialsReceived: request.headers.has("authorization"), envKeys: Object.keys(env) });
  }
};`;

export function workspaceProgram(proofId) {
  return `
const fs = await import("node:fs/promises");
const assert = (await import("node:assert/strict")).default;
const { createHash } = await import("node:crypto");
const source = ${JSON.stringify(service)};
await fs.writeFile("/tmp/restyle-service.mjs", source);
const module = await import("file:///tmp/restyle-service.mjs");
const result = await module.default.fetch(new Request("https://fixture.invalid/call", { method: "POST", body: JSON.stringify({ value: 21 }) }));
assert.deepEqual(await result.json(), { answer: 42, credentialsReceived: false, envKeys: [] });
let networkBlocked = false;
try { await fetch("https://example.com", { signal: AbortSignal.timeout(1000) }); } catch { networkBlocked = true; }
assert.equal(networkBlocked, true);
console.log(JSON.stringify({ proofId: ${JSON.stringify(proofId)}, platform: process.platform, node: process.version, networkBlocked, testsPassed: true, source, sha256: createHash("sha256").update(source).digest("hex") }));
`;
}
