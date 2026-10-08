import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
export function selectedTestRunner(observations = []) {
  return async (request) => {
    const input = await request.json();
    if (input.kind !== "execute") return Response.json({});
    const directory = await mkdtemp(join(tmpdir(), "restyle-repair-workshop-"));
    try {
      for (const file of input.files) {
        const path = join(directory, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content);
      }
      const result = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--test", ...input.command.paths],
          {
            cwd: directory,
            env: { PATH: process.env.PATH },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (data) => (stdout += data));
        child.stderr.on("data", (data) => (stderr += data));
        child.on("error", reject);
        child.on("close", (exitCode) =>
          resolve({
            exitCode,
            stdout: stdout.slice(0, 4000),
            stderr: stderr.slice(0, 4000),
          }),
        );
      });
      observations.push(result.exitCode);
      return Response.json(result);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
