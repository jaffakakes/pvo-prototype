import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { analyzeEntryGraph } from "../scripts/checks/helpers/entry-graph.mjs";

test("entry graph includes HTML, workers, public exports and embedded test imports", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "restyle-entry-graph-"));
  try {
    const sources = {
      "editor/index.html": '<script type="module" src="/src/main.ts"></script>',
      "editor/src/main.ts":
        'import "./feature"; new Worker(new URL("./worker.ts", import.meta.url));',
      "editor/src/feature.ts": "export const feature = 1;",
      "editor/src/worker.ts": "export const worker = 1;",
      "editor/src/test-support.ts": "export const support = 1;",
      "editor/src/types.ts": "export interface OnlyTypes { name: string }",
      "editor/src/orphan.ts": "export const orphan = 1;",
      "tests/fixture.mjs":
        'const source = `import { support } from "./editor/src/test-support.ts";`;',
      "packages/sdk/package.json": '{"exports":{".":"./public.js"}}',
      "packages/sdk/public.js": "export const publicApi = 1;",
    };
    for (const [path, source] of Object.entries(sources)) {
      const file = resolve(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }
    const policy = {
      runtimeDirectories: ["editor/src", "packages"],
      toolDirectories: ["tests"],
      htmlDirectories: ["editor"],
      applicationEntries: [],
      manualEntries: [],
    };
    const result = await analyzeEntryGraph(root, policy);
    assert.deepEqual(result.disconnected, ["editor/src/orphan.ts"]);
    assert.deepEqual(result.toolOnly, ["editor/src/test-support.ts"]);
    await assert.rejects(
      analyzeEntryGraph(root, {
        ...policy,
        manualEntries: [{ path: "editor/src/orphan.ts" }],
      }),
      /need a reason/,
    );
    await assert.rejects(
      analyzeEntryGraph(root, {
        ...policy,
        manualEntries: [{ path: "missing.js", reason: "container" }],
      }),
      /Missing manual/,
    );
    const intentional = await analyzeEntryGraph(root, {
      ...policy,
      manualEntries: [
        {
          path: "editor/src/orphan.ts",
          reason: "A separate process starts this module.",
        },
      ],
    });
    assert.deepEqual(intentional.disconnected, []);
  } finally {
    // mkdtemp owns this exact absolute fixture directory.
    assert(
      dirname(root) === resolve(tmpdir()) &&
        root.includes("restyle-entry-graph-"),
    );
    await rm(root, { recursive: true, force: true });
  }
});
