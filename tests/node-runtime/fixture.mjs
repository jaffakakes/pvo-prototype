import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { parseNodeBundle } from "../../packages/pvo-assistant/services/index.js";
import { nodeExecutionBody } from "../../server/cloud-services/node/protocol.js";

const execute = promisify(execFile);
/** Executes repository-owned test fixtures in fresh local processes, not a production sandbox or isolation proof. */
export async function fixtureNodeEffect(request) {
  const { bundle, invocation } = await request.json();
  parseNodeBundle(bundle);
  const input = JSON.parse(nodeExecutionBody(bundle, invocation));
  const directory = await mkdtemp(join(tmpdir(), "restyle-node-fixture-"));
  try {
    const files = [...input.bundle.files];
    for (const library of input.bundle.dependencies)
      for (const file of library.files)
        files.push({
          path: `node_modules/${library.name}/${file.path}`,
          content: file.content,
        });
    for (const file of files) {
      const path = join(directory, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content, { flag: "wx", mode: 0o600 });
    }
    await writeFile(join(directory, "input.json"), JSON.stringify(invocation));
    await writeFile(
      join(directory, "fixture.mjs"),
      `
import {readFileSync} from 'node:fs';
// Controlled network reply for repository fixtures only; this is not an isolation boundary.
globalThis.fetch = async () => {throw new Error('Fixture network disabled');};
const {execute} = await import(${JSON.stringify("./" + bundle.entrypoint)});
const value = await execute(JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8')));
process.stdout.write(JSON.stringify(value));
`,
    );
    const result = await execute(process.execPath, ["fixture.mjs"], {
      cwd: directory,
      env: {},
      timeout: 2000,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
    });
    try {
      return Response.json({ ok: true, value: JSON.parse(result.stdout) });
    } catch {
      return Response.json({ ok: false, code: "invalid_reply" });
    }
  } catch (error) {
    return Response.json({
      ok: false,
      code:
        error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
          ? "output_limit"
          : error.killed
            ? "timeout"
            : "execution_failed",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
