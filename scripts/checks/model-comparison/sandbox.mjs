import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  parseServiceFiles,
  parseServiceFilePath,
} from "../../../packages/pvo-assistant/services/index.js";

const bootstrap = `
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {execFile} from 'node:child_process';
let input='';for await(const part of process.stdin)input+=part;
const request=JSON.parse(input);
for(const file of request.files){const path='/workspace/'+file.path;await mkdir(dirname(path),{recursive:true});await writeFile(path,file.content,{flag:'wx'});}
const result=await new Promise(resolve=>execFile(process.execPath,request.args,{cwd:'/workspace',env:{},timeout:12000,maxBuffer:16384,killSignal:'SIGKILL'},(error,stdout,stderr)=>resolve({exitCode:error?Number.isInteger(error.code)?error.code:1:0,stdout,stderr})));
process.stdout.write(JSON.stringify(result));`;
const invoke = `import {readFile} from 'node:fs/promises';const {execute}=await import('./'+process.argv[1]);const input=JSON.parse(await readFile('src/benchmark-input.mjs','utf8'));process.stdout.write(JSON.stringify(await execute(input)));`;

async function docker(args, input = "", timeout = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const output = [],
      errors = [];
    let size = 0,
      failure = null;
    const timer = setTimeout(() => {
      failure = new Error("Isolated check timed out.");
      child.kill("SIGKILL");
    }, timeout);
    for (const [stream, collection] of [
      [child.stdout, output],
      [child.stderr, errors],
    ])
      stream.on("data", (part) => {
        size += part.length;
        if (size > 128 * 1024) {
          failure = new Error("Isolated check exceeded its output bound.");
          child.kill("SIGKILL");
        } else collection.push(part);
      });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else
        resolve({
          code,
          stdout: Buffer.concat(output).toString(),
          stderr: Buffer.concat(errors).toString(),
        });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Local, network-disabled Docker execution. No host directories, credentials or Docker socket enter it. */
export async function comparisonSandbox(saveResource) {
  const inspected = await docker([
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    "restyle-node-runtime:1g-proof",
  ]);
  const image = inspected.stdout.trim();
  if (inspected.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error("The local Node comparison image is unavailable.");
  const version = await docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    image,
    "--version",
  ]);
  if (version.code !== 0 || version.stdout.trim() !== "v24.20.0")
    throw new Error("Comparison requires the checked Node 24.20.0 runtime.");
  async function run(files, args) {
    files = parseServiceFiles(files);
    const name = `restyle-model-${randomUUID()}`;
    const resource = {
      name,
      image,
      createdAt: new Date().toISOString(),
      cleaned: false,
    };
    await saveResource(resource);
    try {
      const result = await docker(
        [
          "run",
          "--rm",
          "--interactive",
          "--init",
          "--name",
          name,
          "--platform",
          "linux/amd64",
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
          "/workspace:rw,noexec,nosuid,size=32m,mode=1777",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
          "--user",
          "node",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--log-driver",
          "none",
          "--entrypoint",
          "node",
          image,
          "--input-type=module",
          "-e",
          bootstrap,
        ],
        JSON.stringify({ files, args }),
      );
      if (result.code !== 0)
        throw new Error("Isolated Node check could not run.");
      return JSON.parse(result.stdout);
    } finally {
      const removed = await docker(["rm", "--force", name]);
      const remaining = await docker([
        "ps",
        "--all",
        "--quiet",
        "--filter",
        `name=^/${name}$`,
      ]);
      resource.cleaned = remaining.code === 0 && remaining.stdout.trim() === "";
      resource.cleanupExitCode = removed.code;
      await saveResource(resource);
      if (!resource.cleaned)
        throw new Error("Comparison container cleanup is unconfirmed.");
    }
  }
  return {
    image,
    nodeVersion: version.stdout.trim(),
    command(files, kind, paths) {
      paths.forEach(parseServiceFilePath);
      return run(
        files,
        kind === "check"
          ? ["--check", paths[0]]
          : ["--test", "--test-concurrency=1", ...paths],
      );
    },
    async execute(files, entrypoint, invocation) {
      parseServiceFilePath(entrypoint);
      if (files.some((file) => file.path === "src/benchmark-input.mjs"))
        throw new Error("Reserved benchmark path.");
      const source = files.filter((file) => file.path.startsWith("src/"));
      const result = await run(
        [
          ...source,
          {
            path: "src/benchmark-input.mjs",
            content: JSON.stringify(invocation),
          },
        ],
        ["--input-type=module", "-e", invoke, entrypoint],
      );
      if (result.exitCode !== 0)
        throw new Error("Generated operation failed in isolation.");
      return JSON.parse(result.stdout);
    },
  };
}
