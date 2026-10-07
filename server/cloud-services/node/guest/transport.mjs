import { spawn } from "node:child_process";
import { readFileSync, statSync, writeFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { sandboxFlags } from "./sandbox.mjs";

// The provider command stays tiny. Source is data in fixed host-only files, never a command.
const [mode, ...extra] = process.argv.slice(2);
if (extra.length || !["--ready", "--execute"].includes(mode)) process.exit(2);
let request = { path: "/ready" };
if (mode === "--execute") {
  const path = "/control/invocation.json";
  if (statSync(path).size > 256) process.exit(2);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (
    !Number.isInteger(manifest.parts) ||
    manifest.parts < 1 ||
    manifest.parts > 80 ||
    !Number.isInteger(manifest.bytes) ||
    manifest.bytes < 1 ||
    manifest.bytes > 1152 * 1024 ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  )
    process.exit(2);
  const parts = [];
  for (let index = 0; index < manifest.parts; index++) {
    const partPath = `/control/invocation/${String(index).padStart(3, "0")}`;
    if (statSync(partPath).size > (index === 0 ? 700000 : 6144))
      process.exit(2);
    parts.push(readFileSync(partPath));
  }
  const body = Buffer.concat(parts);
  if (
    body.length !== manifest.bytes ||
    createHash("sha256").update(body).digest("hex") !== manifest.sha256
  )
    process.exit(2);
  request = { path: "/execute", body: body.toString("utf8") };
}
const input = Buffer.from(request.body ?? "");
if (input.length > 1152 * 1024) process.exit(2);
// Encode admitted bytes once: JSON-encoding them again could double escaped source past Linux's argv limit.
const chunks = input.toString("base64").match(/.{1,65536}/g) ?? [];

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
    mode,
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
