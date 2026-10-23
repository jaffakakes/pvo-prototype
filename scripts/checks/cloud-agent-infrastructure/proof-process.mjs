import { spawn } from "node:child_process";

/** Own a command group; a timeout remains a failure even if its wrapper exits zero. */
export function proofProcess(command, args, options = {}) {
  const {
    input,
    timeoutMs = 300_000,
    maxBuffer = 1024 * 1024,
    ...spawnOptions
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [],
      stderr = [];
    let failure = null,
      bytes = 0;
    const stop = (reason) => {
      failure ??= reason;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") failure = error;
      }
    };
    const timer = setTimeout(
      () => stop(new Error("Proof command timed out")),
      timeoutMs,
    );
    const collect = (target, part) => {
      bytes += part.length;
      if (bytes > maxBuffer)
        stop(new Error("Proof command output exceeded its bound"));
      else target.push(part);
    };
    child.stdout.on("data", (part) => collect(stdout, part));
    child.stderr.on("data", (part) => collect(stderr, part));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const result = {
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      };
      if (failure || code !== 0 || signal)
        reject(
          Object.assign(failure ?? new Error("Proof command failed"), result),
        );
      else resolve(result);
    });
  });
}
