import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { proofCommand } from "../../scripts/checks/cloud-agent-infrastructure/proof-command.mjs";
import { proofProcess } from "../../scripts/checks/cloud-agent-infrastructure/proof-process.mjs";

test("a timed-out command cannot leave an inherited upload process holding its pipes open", async () => {
  const started = Date.now();
  await assert.rejects(
    proofProcess(
      process.execPath,
      [
        "-e",
        `
      const {spawn}=require('node:child_process');
      spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
      process.on('SIGTERM',()=>process.exit(0));
      setInterval(()=>{},1000);
    `,
      ],
      { timeoutMs: 150 },
    ),
    /timed out/,
  );
  assert.ok(
    Date.now() - started < 3000,
    "Descendant pipes were closed with the command group",
  );
  await assert.rejects(
    proofProcess(
      process.execPath,
      [
        "-e",
        "process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000)",
      ],
      { maxBuffer: 32 },
    ),
    /output exceeded/,
  );
});

test("proof command retains successful and failed diagnostics with credentials redacted", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "restyle-command-"));
  try {
    const bin = resolve(directory, "node_modules/wrangler/bin");
    await mkdir(bin, { recursive: true });
    await writeFile(
      resolve(bin, "wrangler.js"),
      `console.log(process.env.CLOUDFLARE_API_TOKEN);
console.error("private-proof-secret");
if (process.argv.includes("fail")) process.exitCode = 1;
`,
    );
    const resource = { kind: "workspace", config: "unused-test-config" };
    const options = {
      root: directory,
      directory,
      token: "private-account-token",
      secrets: ["private-proof-secret"],
    };
    await proofCommand(resource, ["deploy"], options);
    await assert.rejects(
      proofCommand(resource, ["fail"], options),
      /Proof command failed; see private diagnostic/,
    );
    for (const command of ["deploy", "fail"]) {
      const file = resolve(directory, `workspace-${command}-command.log`);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal(await readFile(file, "utf8"), "[redacted]\n\n[redacted]\n");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
