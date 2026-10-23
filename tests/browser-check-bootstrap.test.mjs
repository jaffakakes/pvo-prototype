import assert from "node:assert/strict";
import test from "node:test";
import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  resolveBrowserExecutable,
  createBrowserFixture,
} from "../scripts/checks/helpers/browser.mjs";

test("browser executable lookup supports all hosts and respects explicit overrides", () => {
  for (const [platform, suffix] of [
    ["win32", "chrome.exe"],
    ["darwin", "Google Chrome"],
    ["linux", "google-chrome"],
  ]) {
    const result = resolveBrowserExecutable({
      platform,
      env: {},
      exists: (file) => file.endsWith(suffix),
    });
    assert(result.endsWith(suffix));
  }
  assert.equal(
    resolveBrowserExecutable({
      platform: "linux",
      env: { CHROME_PATH: "/opt/custom/chrome" },
      exists: (file) => file === "/opt/custom/chrome",
    }),
    "/opt/custom/chrome",
  );
  assert.equal(
    resolveBrowserExecutable({
      platform: "linux",
      env: { CHROME_PATH: "chrome", PATH: "/opt/bin:/usr/bin" },
      exists: (file) => file === "/opt/bin/chrome",
    }),
    "/opt/bin/chrome",
  );
  assert.throws(
    () =>
      resolveBrowserExecutable({
        env: { CHROME_PATH: "/missing/chrome" },
        exists: () => false,
      }),
    /CHROME_PATH/,
  );
  assert.throws(
    () => resolveBrowserExecutable({ env: {}, exists: () => false }),
    /Install one/,
  );
});

test("only registered browser scenarios can run, with helpers excluded", async () => {
  const registry = JSON.parse(
    await readFile(
      new URL("../scripts/checks/browser-checks.json", import.meta.url),
      "utf8",
    ),
  );
  for (const [suite, checks] of Object.entries(registry)) {
    assert.equal(new Set(checks).size, checks.length);
    for (const name of checks) {
      assert(!name.endsWith("-fixture"));
      await access(
        new URL(`../scripts/checks/${suite}/${name}.mjs`, import.meta.url),
      );
    }
  }
  const result = spawnSync(
    process.execPath,
    ["scripts/checks/run.mjs", "editor", "assistant-fixture"],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown editor check/);
});

test("a fixture closes its owned HTTP server when browser setup fails", async () => {
  const previous = process.env.CHROME_PATH;
  process.env.CHROME_PATH = "/missing/browser-bootstrap-fixture";
  try {
    await assert.rejects(createBrowserFixture(new Map()), /CHROME_PATH/);
  } finally {
    if (previous === undefined) delete process.env.CHROME_PATH;
    else process.env.CHROME_PATH = previous;
  }
});
