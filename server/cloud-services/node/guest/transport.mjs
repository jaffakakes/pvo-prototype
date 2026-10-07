import { spawn } from "node:child_process";
import { writeFileSync, writeSync } from "node:fs";
import { sandboxFlags } from "./sandbox.mjs";

// Trusted host transport permits only the fixed sandbox bridge. Input is data, never a command.
const chunks = process.argv.slice(2);
const encoded = chunks.join("");
if (
  chunks.some((chunk) => chunk.length > 65536) ||
  encoded.length > 1600 * 1024 ||
  !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
)
  process.exit(2);
const input = Buffer.from(encoded, "base64");
if (input.length > 1200 * 1024 || input.toString("base64") !== encoded)
  process.exit(2);
const request = JSON.parse(input.toString("utf8"));
if (
  !["/ready", "/execute"].includes(request.path) ||
  (request.path === "/execute" && typeof request.body !== "string")
)
  process.exit(2);

// Host-only metadata makes interrupted transport diagnosable without retaining service data.
const observation = {
  startedAt: Date.now(),
  path: request.path,
  phase: "starting",
};
const observe = (fields) => {
  Object.assign(observation, fields, {
    elapsedMs: Date.now() - observation.startedAt,
  });
  writeFileSync("/control/transport-status.json", JSON.stringify(observation), {
    mode: 0o600,
  });
};
observe({});

const child = spawn(
  "/opt/gvisor/runsc",
  [
    ...sandboxFlags,
    "exec",
    "--user=1000:1000",
    "service",
    "/usr/local/bin/node",
    "/runtime/bridge.mjs",
    ...chunks,
  ],
  { stdio: ["ignore", "pipe", "ignore"], env: { PATH: "/usr/bin:/bin" } },
);
let finished = false;
let bytes = 0;
const parts = [];
const finish = (status, body = "") => {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  child.kill("SIGKILL");
  observe({ phase: "finished", status, stdoutBytes: bytes });
  writeSync(1, JSON.stringify({ status, body }));
};
const timer = setTimeout(() => finish(504), 3000);
child.stdout.on("data", (part) => {
  bytes += part.length;
  // A JSON wrapper can escape each reply byte. The caller separately bounds decoded UTF-8 bytes.
  if (bytes > 6 * 65536 + 4096) return finish(413);
  parts.push(part);
});
child.once("error", () => finish(503));
child.once("exit", (code, signal) =>
  observe({ phase: "exited", code, signal }),
);
child.once("close", (code) => {
  if (finished) return;
  if (code !== 0) return finish(503);
  try {
    const reply = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (
      !Number.isInteger(reply.status) ||
      reply.status < 200 ||
      reply.status > 599 ||
      typeof reply.body !== "string"
    )
      return finish(422);
    if (Buffer.byteLength(reply.body) > 65536) return finish(413);
    finish(reply.status, reply.body);
  } catch {
    finish(422);
  }
});
