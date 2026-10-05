import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Readable } from "node:stream";
import { WorkspaceContainer } from "../../server/assistant/workspaces/container.js";
import { WORKSPACE_LIMITS as limits } from "../../packages/pvo-assistant/workspaces/index.js";
import { files } from "./helpers.mjs";

const stream = (text) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
const processResult = (stdout = "", stderr = "", exitCode = 0) => ({
  stdout: stream(stdout),
  stderr: stream(stderr),
  exitCode: Promise.resolve(exitCode),
});

test("native adapter keeps startup network disabled and commands in the fixed directory with actual exit status", async () => {
  let startup, args, options;
  const provider = new WorkspaceContainer({
    start(value) {
      startup = value;
    },
    async exec(argv, value) {
      args = argv;
      options = value;
      return processResult("out", "failure", 7);
    },
  });
  provider.start({ resourceId: `workspace-${"a".repeat(64)}`, session: 1 });
  assert.equal(startup.enableInternet, false);
  assert.equal(startup.labels.workspace.length, 64);
  assert.deepEqual(startup.entrypoint, ["sleep", "120"]);
  assert.equal(startup.env, undefined);
  assert.deepEqual(
    await provider.execute({ kind: "test", paths: ["tests/service.test.mjs"] }),
    { stdout: "out", stderr: "failure", exitCode: 7 },
  );
  assert.deepEqual(args, ["node", "--test", "tests/service.test.mjs"]);
  assert.deepEqual(options, { cwd: "/workspace" });
});

test("combined stdout/stderr bytes and malformed text cannot create an unlimited saved report", async () => {
  const provider = new WorkspaceContainer({
    async exec() {
      return processResult("a".repeat(limits.outputBytes), "overflow");
    },
  });
  await assert.rejects(
    provider.execute({ kind: "test", paths: ["tests/a.mjs"] }),
    /output limit/,
  );
  const invalid = new WorkspaceContainer({
    async exec() {
      return {
        ...processResult(),
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([255]));
            c.close();
          },
        }),
      };
    },
  });
  await assert.rejects(
    invalid.execute({ kind: "check", paths: ["src/a.mjs"] }),
    /encoded data/,
  );
});

test("restore rechecks cancellation after provider setup before dispatching filesystem writes", async () => {
  let execs = 0;
  const provider = new WorkspaceContainer({
    async setInactivityTimeout() {},
    async exec() {
      execs++;
      return processResult();
    },
  });
  await assert.rejects(
    provider.restore({ files: files() }, () => {
      throw new Error("stale action");
    }),
    /stale/,
  );
  assert.equal(execs, 0);
});

test("the actual restore program writes exact bytes and rejects existing files, symlinks and traversal", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "restyle-restore-test-"));
  const root = join(temporary, "workspace");
  const provider = new WorkspaceContainer({
    async setInactivityTimeout() {},
    async exec(argv, options) {
      // Only replace the adapter's fixed VM root with this test's disposable local directory.
      const child = spawn(process.execPath, [...argv.slice(1, -1), root], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exitCode = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", resolve);
      });
      const reader = options.stdin.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        child.stdin.write(value);
      }
      child.stdin.end();
      return {
        stdout: Readable.toWeb(child.stdout),
        stderr: Readable.toWeb(child.stderr),
        exitCode,
      };
    },
  });
  try {
    await provider.restore({ files: files() }, () => {});
    assert.equal(
      await readFile(join(root, "src/service.mjs"), "utf8"),
      files()[0].content,
    );
    await assert.rejects(
      provider.restore({ files: files() }, () => {}),
      /restoration failed/,
    );
    await rm(root, { recursive: true, force: true });
    await mkdir(root);
    const outside = join(temporary, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "private.mjs"), "preserved");
    await symlink(outside, join(root, "src"));
    await assert.rejects(
      provider.restore(
        { files: [{ path: "src/private.mjs", content: "overwritten" }] },
        () => {},
      ),
      /restoration failed/,
    );
    assert.equal(
      await readFile(join(outside, "private.mjs"), "utf8"),
      "preserved",
    );
    await assert.rejects(
      provider.restore(
        { files: [{ path: "../outside/private.mjs", content: "overwritten" }] },
        () => {},
      ),
      /restoration failed/,
    );
    assert.equal(
      await readFile(join(outside, "private.mjs"), "utf8"),
      "preserved",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
