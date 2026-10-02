import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { AlignmentError, MAX_BODY_BYTES, parseAlignmentInput } from "./contract.mjs";
import { createMfaRunner } from "./process.mjs";

function authorize(value, token) {
  const received = Buffer.from(value ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function reply(response, status, value) {
  if (response.destroyed) return;
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readInput(request) {
  const length = Number(request.headers["content-length"]);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new AlignmentError(413, "alignment_input_too_large");
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new AlignmentError(415, "alignment_json_required");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AlignmentError(413, "alignment_input_too_large");
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AlignmentError(400, "alignment_invalid_json"); }
  return parseAlignmentInput(input);
}

export function createAlignmentServer({ token, runAlignment }) {
  if (typeof token !== "string" || token.length < 32 || /\s/u.test(token)) throw new Error("A private token of at least 32 characters is required");
  let active;
  const server = createServer(async (request, response) => {
    if (!authorize(request.headers.authorization, token)) {
      reply(response, 401, { error: { code: "alignment_unauthorized" } });
      request.resume();
      return;
    }
    if (request.method !== "POST" || request.url !== "/align") {
      reply(response, 404, { error: { code: "alignment_not_found" } });
      request.resume();
      return;
    }
    if (active) {
      reply(response, 429, { error: { code: "alignment_busy" } });
      request.resume();
      return;
    }
    const controller = new AbortController();
    active = controller;
    const cancel = () => { if (!response.writableEnded) controller.abort(); };
    request.once("aborted", cancel);
    response.once("close", cancel);
    try {
      const input = await readInput(request);
      if (controller.signal.aborted) return;
      const result = await runAlignment(input, controller.signal);
      reply(response, 200, result);
    } catch (error) {
      const safe = error instanceof AlignmentError ? error : new AlignmentError(503, "alignment_unavailable");
      reply(response, safe.status, { error: { code: safe.code } });
    } finally {
      request.removeListener("aborted", cancel);
      response.removeListener("close", cancel);
      active = undefined;
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.on("close", () => active?.abort());
  server.cancelAlignment = () => active?.abort();
  return server;
}

async function main() {
  const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) =>
    [process.argv[2 + index * 2], process.argv[3 + index * 2]]));
  if (!args["--token-file"] || !args["--mfa"] || !args["--root"]
      || Object.keys(args).some(key => !["--token-file", "--mfa", "--root", "--port"].includes(key))) {
    throw new Error("Use --token-file FILE --mfa EXECUTABLE --root MFA_ROOT [--port 5198]");
  }
  const token = (await readFile(args["--token-file"], "utf8")).trim();
  const port = args["--port"] === undefined ? 5198 : Number(args["--port"]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local port");
  const server = createAlignmentServer({ token, runAlignment: createMfaRunner({ mfa: args["--mfa"], root: args["--root"] }) });
  server.listen(port, "127.0.0.1", () => console.log(`MFA alignment listening at 127.0.0.1:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    server.cancelAlignment();
    server.close();
    server.closeAllConnections();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("MFA alignment service could not start; check local configuration."); process.exitCode = 1; });
}
