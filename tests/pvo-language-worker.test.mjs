import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("public Worker compiler initializes static WASM and preserves validation diagnostics", async () => {
  const moduleFiles = ["worker.js", "result.js", "pkg/pvo_language.js", "pkg/pvo_language_bg.wasm"];
  const modules = await Promise.all(moduleFiles.map(async file => ({
    type: file.endsWith(".wasm") ? "CompiledWasm" : "ESModule",
    path: resolve("packages/pvo-language", file),
    contents: await readFile(resolve("packages/pvo-language", file), file.endsWith(".wasm") ? undefined : "utf8"),
  })));
  const fixture = new Miniflare(convertV4MiniflareOptions({
    name: "pvo-language-worker-test", compatibilityDate: "2026-09-27",
    modules: [{ type: "ESModule", path: resolve(".wrangler/language-probe.mjs"), contents: `
      import { compilePvoComponent, isPvoLanguageActionAllowed, PvoLanguageError } from "../packages/pvo-language/worker.js";
      export default { async fetch(request) {
        const { kind, source } = await request.json();
        try { return Response.json({ compiled: await compilePvoComponent(kind, source), allowed: isPvoLanguageActionAllowed(kind, "continue") }); }
        catch (error) { return Response.json({ name: error.name, typed: error instanceof PvoLanguageError, part: error.part, diagnostic: error.diagnostic }, { status: 422 }); }
      } };`,
    }, ...modules],
  }));
  try {
    const source = { structure: '<card><title>Ready</title><button id="next">Continue</button></card>', style: "", logic: "on press(next) { continue(); }" };
    const send = body => fixture.dispatchFetch("https://compiler.example/", { method: "POST", body: JSON.stringify(body) });
    const valid = await send({ kind: "card", source });
    const result = await valid.json();
    assert.equal(valid.status, 200);
    assert.equal(result.compiled.js, "");
    assert.equal(result.compiled.structure.type, "card");
    for (const [part, replacement] of [
      ["structure", '<div onclick="alert(1)">Unsafe</div>'],
      ["style", "card { position: fixed; }"],
      ["logic", 'fetch("https://example.com");'],
    ]) {
      const invalid = await send({ kind: "card", source: { ...source, [part]: replacement } });
      const error = await invalid.json();
      assert.equal(invalid.status, 422);
      assert.equal(error.name, "PvoLanguageError");
      assert.equal(error.typed, true);
      assert.equal(error.part, part);
      assert.ok(error.diagnostic.line > 0 && error.diagnostic.column > 0);
    }
    assert.equal((await send({ kind: "card", source })).status, 200, "A compiler rejection must not poison the shared instance");
  } finally { await fixture.dispose(); }
});
