import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AlignmentError, parseAlignmentOutput } from "./contract.mjs";

const RUNNER = fileURLToPath(new URL("./runner.py", import.meta.url));

async function killProcessTree(pid, signal) {
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", reject);
      killer.once("close", (code) => {
        // taskkill returns 128 when the process has already exited.
        if (code === 0 || code === 128) resolve();
        else reject(new AlignmentError(503, "alignment_unavailable"));
      });
    });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

export function createMfaRunner({
  mfa,
  root,
  timeoutMs = 110_000,
  runner = RUNNER,
  python = path.join(
    path.dirname(path.resolve(mfa)),
    process.platform === "win32" ? "python.exe" : "python",
  ),
}) {
  const executable = path.resolve(mfa);
  const runtimeRoot = path.resolve(root);
  return async (input, signal) => {
    // MFA rejects a corpus inside its own global temporary/model directory.
    const jobs = path.join(path.dirname(runtimeRoot), "alignment-jobs");
    if (jobs.startsWith(runtimeRoot))
      throw new AlignmentError(503, "alignment_unavailable");
    await mkdir(jobs, { recursive: true, mode: 0o700 });
    const job = await mkdtemp(path.join(jobs, "alignment-"));
    let child;
    let timer;
    let killTimer;
    let failure;
    let termination;
    const stop = (error) => {
      failure ??= error;
      if (!child?.pid || termination) return;
      termination = killProcessTree(child.pid, "SIGTERM").catch(() =>
        child.kill("SIGKILL"),
      );
      if (process.platform === "win32") return;
      killTimer ??= setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Group already exited. */
        }
      }, 500);
    };
    const abort = () => stop(new AlignmentError(499, "alignment_cancelled"));
    try {
      if (signal?.aborted) throw new AlignmentError(499, "alignment_cancelled");
      child = spawn(
        python,
        [runner, "--mfa", executable, "--root", runtimeRoot, "--job", job],
        {
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          cwd: job,
        },
      );
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => stop(new AlignmentError(504, "alignment_timeout")),
        timeoutMs,
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        if (Buffer.byteLength(output) + chunk.length > 128_000) {
          stop(new AlignmentError(502, "alignment_invalid_response"));
          return;
        }
        output += chunk.toString("utf8");
      });
      // Detailed CLI errors remain in the owned job directory until cleanup.
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(input));
      const code = await new Promise((resolve, reject) => {
        child.once("error", () =>
          reject(new AlignmentError(503, "alignment_unavailable")),
        );
        child.once("close", resolve);
      });
      if (failure) throw failure;
      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch {
        throw new AlignmentError(502, "alignment_invalid_response");
      }
      if (code !== 0) {
        const known = [
          "alignment_failed",
          "alignment_incomplete",
          "alignment_runtime_mismatch",
          "alignment_not_refined",
        ];
        const error = known.includes(parsed?.error?.code)
          ? parsed.error.code
          : "alignment_failed";
        throw new AlignmentError(
          error === "alignment_runtime_mismatch" ? 503 : 422,
          error,
        );
      }
      return parseAlignmentOutput(parsed, input);
    } finally {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      try {
        await termination;
        if (child?.pid) await killProcessTree(child.pid, "SIGKILL");
      } finally {
        await rm(job, { recursive: true, force: true });
      }
    }
  };
}
