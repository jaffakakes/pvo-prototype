import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

/** Local proof only: the Docker VM receives no host mounts, network, credentials or Docker socket. */
function command(args, input = null, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    const stdout = [],
      stderr = [];
    let bytes = 0;
    child.on("error", reject);
    const collect = (target, part) => {
      bytes += part.length;
      if (bytes > 2 * 1024 * 1024) {
        child.kill("SIGKILL");
        reject(new Error("Docker proof output exceeded its bound."));
      } else target.push(part);
    };
    child.stdout.on("data", (part) => collect(stdout, part));
    child.stderr.on("data", (part) => collect(stderr, part));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("close", (code) => {
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      };
      if (code !== 0)
        reject(
          Object.assign(new Error(`Docker proof command failed (${code}).`), {
            result,
          }),
        );
      else resolve(result);
    });
  });
}
const fetchProgram = `let input='';for await(const chunk of process.stdin)input+=chunk;
const request=JSON.parse(input);const response=await fetch('http://127.0.0.1:8080'+request.path,{method:request.method,body:request.body,headers:{'Content-Type':'application/json'}});
let bytes=0;const parts=[];for await(const part of response.body){bytes+=part.length;if(bytes>65536){process.stdout.write(JSON.stringify({status:413,body:''}));process.exit(0);}parts.push(part);}
process.stdout.write(JSON.stringify({status:response.status,body:Buffer.concat(parts).toString()}));`;

export async function dockerContainer() {
  const name = `restyle-node-local-${randomUUID()}`;
  const image = "restyle-node-runtime:1g-proof";
  const inspected = await command([
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ]);
  const pinned = `local@${inspected.stdout.trim()}`;
  let started = null;
  return {
    name,
    images: { runtime: pinned },
    running: false,
    start(options) {
      if (
        options.image !== pinned ||
        options.enableInternet !== false ||
        options.instance !== "lite"
      )
        throw new Error("Unsafe local proof options.");
      this.running = true;
      started = command([
        "run",
        "--detach",
        "--platform",
        "linux/amd64",
        "--name",
        name,
        "--network",
        "none",
        "--memory",
        "256m",
        "--cpus",
        "1",
        "--pids-limit",
        "64",
        "--read-only",
        "--tmpfs",
        "/service:rw,noexec,nosuid,size=16m",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=16m",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--log-driver",
        "none",
        image,
      ]);
    },
    async setInactivityTimeout() {
      await started;
    },
    async inspect() {
      if (!started) return null;
      await started;
      const result = await command([
        "inspect",
        "--format",
        "{{.State.Running}}",
        name,
      ]);
      this.running = result.stdout.trim() === "true";
      return this.running ? { image: pinned } : null;
    },
    getTcpPort(port) {
      if (port !== 8080) throw new Error("Unexpected proof port.");
      return {
        fetch: async (url, options = {}) => {
          await started;
          const result = await command(
            [
              "exec",
              "--interactive",
              name,
              "node",
              "--input-type=module",
              "-e",
              fetchProgram,
            ],
            JSON.stringify({
              path: new URL(url).pathname,
              method: options.method ?? "GET",
              body: options.body,
            }),
            options.signal,
          );
          const response = JSON.parse(result.stdout);
          return new Response(response.body, { status: response.status });
        },
      };
    },
    async destroy() {
      if (started) await started.catch(() => {});
      await command(["rm", "--force", name]).catch(() => {});
      started = null;
      this.running = false;
      const remaining = await command([
        "ps",
        "--all",
        "--quiet",
        "--filter",
        `name=^/${name}$`,
      ]);
      if (remaining.stdout.trim())
        throw new Error("Owned local proof container remains.");
    },
  };
}
