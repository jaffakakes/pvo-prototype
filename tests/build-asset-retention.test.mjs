import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { retainEditorAssets } from "../scripts/build/retain-editor-assets.mjs";

const origin = "https://release.example";
const old = "/editor/assets/index-OLD12345.js";
const fresh = "/editor/assets/index-NEW12345.js";
const older = "/editor/assets/index-OLDER123.css";
const inventory = "/editor/retained-assets.json";
const serviceWorker = paths => `const PRECACHE_URLS = ${JSON.stringify(["./index.html", ...paths.map(path => `.${path.slice(7)}`)])};`;
const asset = (body, type = "text/javascript", headers = {}) => () => new Response(body, { headers: { "content-type": type, ...headers } });

async function fixture(t) {
  const distRoot = await mkdtemp(join(tmpdir(), "pvo-asset-retention-"));
  t.after(() => rm(distRoot, { recursive: true, force: true }));
  await mkdir(join(distRoot, "editor/assets"), { recursive: true });
  await writeFile(join(distRoot, fresh.slice(1)), "new immutable code");
  await writeFile(join(distRoot, "editor/sw.js"), "new service worker must not change");
  await writeFile(join(distRoot, "editor/index.html"), "new shell must not change");
  await writeFile(join(distRoot, "editor/release.json"), '{"revision":"new"}');
  const routes = new Map([
    ["/editor/sw.js", asset(serviceWorker([old]))],
    [inventory, () => Response.json({ assets: [older] })],
    [old, asset("old immutable code", "application/javascript")],
    [older, asset(".old { color: red; }", "text/css")],
  ]);
  const calls = [];
  const fetch = async (url, options) => {
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    calls.push(url.pathname);
    const route = routes.get(url.pathname);
    return route ? route() : new Response("Not found", { status: 404 });
  };
  return { distRoot, routes, calls, fetch, run: extras => retainEditorAssets({ distRoot, origin, fetch, ...extras }) };
}

test("retains current and older remote hashes without changing shell, revision or existing assets", async t => {
  const setup = await fixture(t);
  const result = await setup.run();
  assert.deepEqual(result.assets, [fresh, older, old].sort());
  assert.equal(result.downloaded, 2);
  assert.equal(await readFile(join(setup.distRoot, old.slice(1)), "utf8"), "old immutable code");
  assert.equal(await readFile(join(setup.distRoot, fresh.slice(1)), "utf8"), "new immutable code");
  assert.equal(await readFile(join(setup.distRoot, "editor/sw.js"), "utf8"), "new service worker must not change");
  assert.equal(await readFile(join(setup.distRoot, "editor/index.html"), "utf8"), "new shell must not change");
  assert.equal(await readFile(join(setup.distRoot, "editor/release.json"), "utf8"), '{"revision":"new"}');
  assert.deepEqual(JSON.parse(await readFile(join(setup.distRoot, inventory.slice(1)), "utf8")), { assets: result.assets });
  assert(!setup.calls.includes(fresh));
});

test("first inventory404 bootstraps current public and manually retained local assets", async t => {
  const setup = await fixture(t);
  setup.routes.delete(inventory);
  await writeFile(join(setup.distRoot, older.slice(1)), "manually retained css");
  const result = await setup.run();
  assert.equal(result.downloaded, 1);
  assert(result.assets.includes(older));
  assert(!setup.calls.includes(older));
});

test("the emitted inventory preserves older generations on the next clean release", async t => {
  const first = await fixture(t);
  const previous = await first.run();
  const next = await fixture(t);
  next.routes.set(inventory, () => Response.json({ assets: previous.assets }));
  next.routes.set("/editor/sw.js", asset(serviceWorker([fresh])));
  const result = await next.run();
  assert(result.assets.includes(old));
  assert(result.assets.includes(older));
});

test("standard binary, font and image MIME types retain byte-identical files", async t => {
  const setup = await fixture(t);
  const cases = [
    ["pvo_language_bg-DArXHdZK.wasm", "application/wasm", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])],
    ["open-sauce-700-CK0NdHF9.woff2", "font/woff2", Buffer.from("wOF2font")],
    ["mark-IMAGES12.png", "image/png", Buffer.from([137, 80, 78, 71])],
    ["mark-VECTOR12.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
  ];
  const paths = cases.map(([name]) => `/editor/assets/${name}`);
  setup.routes.set(inventory, () => Response.json({ assets: paths }));
  for (const [name, type, body] of cases) setup.routes.set(`/editor/assets/${name}`, asset(body, type));
  await setup.run();
  for (const [name, , body] of cases) assert.deepEqual(await readFile(join(setup.distRoot, "editor/assets", name)), body);
});

test("invalid paths and mutable files in remote inventory fail before output changes", async t => {
  for (const path of ["/editor/index.html", "/editor/assets/../../sw.js", "https://other.example/editor/assets/index-12345678.js", "/editor/assets/plain.js", "/editor/assets/file-12345678.js?query=1", "/editor/assets/file-%2e%2e1234.js"]) {
    const setup = await fixture(t);
    setup.routes.set(inventory, () => Response.json({ assets: [path] }));
    await assert.rejects(setup.run(), /Invalid retained editor asset path/);
    assert.deepEqual(await readdir(join(setup.distRoot, "editor/assets")), [fresh.split("/").at(-1)]);
  }
});

test("missing, wrongly typed, empty, truncated and oversized responses fail before writes", async t => {
  const bad = [
    () => new Response("missing", { status: 404 }),
    asset("<html>not JavaScript</html>", "text/html"),
    asset("", "text/javascript"),
    asset("short", "text/javascript", { "content-length": "100" }),
    asset("small", "text/javascript", { "content-length": String(26 * 1024 * 1024) }),
    () => new Response("partial", { status: 206, headers: { "content-type": "text/javascript" } }),
  ];
  for (const response of bad) {
    const setup = await fixture(t);
    setup.routes.set(old, response);
    await assert.rejects(setup.run());
    assert.deepEqual(await readdir(join(setup.distRoot, "editor/assets")), [fresh.split("/").at(-1)]);
    await assert.rejects(readFile(join(setup.distRoot, inventory.slice(1))), { code: "ENOENT" });
  }
});

test("malformed or incomplete metadata and excessive asset counts are rejected", async t => {
  for (const malformed of ["{}", '{"assets":null}', '{"assets":[],"other":1}', "not json", JSON.stringify({ assets: Array(513).fill(old) })]) {
    const setup = await fixture(t);
    setup.routes.set(inventory, asset(malformed, "application/json"));
    await assert.rejects(setup.run());
  }
  for (const sw of ["unreadable", "const PRECACHE_URLS = [];", 'const PRECACHE_URLS = ["./index.html"];']) {
    const setup = await fixture(t);
    setup.routes.set("/editor/sw.js", asset(sw));
    await assert.rejects(setup.run(), /precache inventory/);
  }
});

test("an unbounded response and a later missing asset never leave partial retention output", async t => {
  const oversized = await fixture(t);
  oversized.routes.set(old, asset(new Uint8Array(26 * 1024 * 1024)));
  await assert.rejects(oversized.run(), /size limit/);
  assert.deepEqual(await readdir(join(oversized.distRoot, "editor/assets")), [fresh.split("/").at(-1)]);
  const lateFailure = await fixture(t);
  lateFailure.routes.delete(older);
  await assert.rejects(lateFailure.run(), /HTTP 404/);
  assert(lateFailure.calls.includes(old));
  assert.deepEqual(await readdir(join(lateFailure.distRoot, "editor/assets")), [fresh.split("/").at(-1)]);
});

test("a file appearing during preparation is never overwritten", async t => {
  const setup = await fixture(t);
  setup.routes.set(old, async () => {
    await writeFile(join(setup.distRoot, old.slice(1)), "another release owns this file");
    return asset("remote contents")();
  });
  await assert.rejects(setup.run(), { code: "EEXIST" });
  assert.equal(await readFile(join(setup.distRoot, old.slice(1)), "utf8"), "another release owns this file");
  await assert.rejects(readFile(join(setup.distRoot, inventory.slice(1))), { code: "ENOENT" });
});

test("retention deadlines abort stalled fetches even when an adapter ignores the signal", async t => {
  const setup = await fixture(t);
  let signal;
  await assert.rejects(setup.run({ timeoutMs: 20, fetch: (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } }), /timed out/);
  assert.equal(signal.aborted, true);
});

test("redirects, non-HTTPS origins and local symlinks cannot escape the retention boundary", async t => {
  const setup = await fixture(t);
  const redirected = new Response("code", { headers: { "content-type": "text/javascript" } });
  Object.defineProperty(redirected, "url", { value: "https://other.example/file.js" });
  setup.routes.set(old, () => redirected);
  await assert.rejects(setup.run(), /changed destination/);
  await assert.rejects(setup.run({ origin: "http://release.example" }), /exact HTTPS/);
  await assert.rejects(setup.run({ origin: "https://release.example/path" }), /exact HTTPS/);
  const linked = await fixture(t);
  await symlink(join(linked.distRoot, "editor/index.html"), join(linked.distRoot, "editor/assets/linked-12345678.js"));
  await assert.rejects(linked.run(), /plain file/);
});
