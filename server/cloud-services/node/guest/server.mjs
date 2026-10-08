import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { restoreBundle } from "./files.mjs";

// Only a provider VM is a security boundary. The controller destroys this whole guest after one call.
const requestBytes = 1152 * 1024,
  replyBytes = 64 * 1024;
const sources = await Promise.all(
  ["files.mjs", "server.mjs"].map(async (path) => ({
    path,
    content: await readFile(new URL(path, import.meta.url), "utf8"),
  })),
);
const runnerDigest = createHash("sha256")
  .update(JSON.stringify(sources))
  .digest("hex");
let used = false;

const server = createServer(async (request, response) => {
  response.setHeader("Connection", "close");
  if (request.method === "GET" && request.url === "/ready" && !used) {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({ nodeVersion: process.versions.node, runnerDigest }),
    );
    return;
  }
  if (request.method !== "POST" || request.url !== "/execute" || used) {
    response.writeHead(409);
    response.end();
    return;
  }
  used = true;
  try {
    const pieces = [];
    let bytes = 0;
    for await (const piece of request) {
      bytes += piece.length;
      if (bytes > requestBytes) throw new Error("Request too large.");
      pieces.push(piece);
    }
    const { bundle, invocation } = JSON.parse(
      Buffer.concat(pieces).toString("utf8"),
    );
    const entrypoint = await restoreBundle(bundle);
    const module = await import(pathToFileURL(entrypoint).href);
    if (typeof module.execute !== "function")
      throw new Error("No execute operation.");
    const reply = JSON.stringify(await module.execute(invocation));
    if (typeof reply !== "string" || Buffer.byteLength(reply) > replyBytes) {
      response.writeHead(413);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(reply);
  } catch {
    response.writeHead(422);
    response.end();
  }
});
server.maxConnections = 1;
server.headersTimeout = 5000;
server.requestTimeout = 5000;
server.listen(8080, "0.0.0.0");
