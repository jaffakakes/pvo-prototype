import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configuredRunpodKey,
  readRunpodKey,
} from "../../scripts/checks/cloud-agent-first-release/credentials.mjs";

test("empty CLI configuration grants no model access; valid single/double quoted keys work", () => {
  assert.equal(
    configuredRunpodKey("apikey = ''\napiurl = 'https://example.test'\n"),
    null,
  );
  assert.equal(configuredRunpodKey('apikey = "  "'), null);
  assert.equal(
    configuredRunpodKey("apikey = 'local-test-key' # comment"),
    "local-test-key",
  );
  assert.equal(
    configuredRunpodKey('apikey = "local-test-key"'),
    "local-test-key",
  );
  assert.equal(configuredRunpodKey("apiurl = 'local-test-key'"), null);
});

test("credential resolution uses private env or CLI file and errors never repeat private content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "restyle-key-test-"));
  const configPath = join(directory, "config.toml");
  try {
    await writeFile(configPath, "apikey = ''\napiurl = 'private-sentinel'", {
      mode: 0o600,
    });
    await assert.rejects(
      readRunpodKey({ environment: {}, configPath }),
      (error) =>
        error.message.includes("missing") &&
        !error.message.includes("private-sentinel"),
    );
    assert.equal(
      await readRunpodKey({
        environment: { RUNPOD_API_KEY: " env-key " },
        configPath,
      }),
      "env-key",
    );
    await writeFile(configPath, "apikey = 'file-key'", { mode: 0o600 });
    assert.equal(
      await readRunpodKey({ environment: {}, configPath }),
      "file-key",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
