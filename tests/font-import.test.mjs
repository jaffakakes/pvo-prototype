import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importFont } from "../server/fonts/import.js";
import { fontsRoute } from "../server/fonts/routes.js";
import { validateFontAsset } from "../packages/pvo-fonts/index.js";

const bytes = await readFile(new URL("../editor/src/fonts/peace-sans.woff2", import.meta.url));
const input = { family: "Peace Sans", url: "https://example.com/font.woff2", licenseUrl: "https://example.com/license" };
const license = "Fixture licence text. User must verify permission before use.";
const options = (font = bytes, text = license, contentType = "text/plain") => ({
  resolveHost: async () => ["93.184.216.34"],
  fetch: async url => new Response(url.endsWith("font.woff2") ? font : text, {
    headers: { "Content-Type": url.endsWith("font.woff2") ? "font/woff2" : contentType },
  }),
});

test("public font imports preserve real bytes, attribution, full licence and stable content identity", async () => {
  const font = await importFont(input, options());
  assert.deepEqual(validateFontAsset(font), font);
  assert.match(font.id, /^web-[0-9a-f]{24}$/);
  assert.equal(font.sourceUrl, input.url);
  assert.equal(font.licenseUrl, input.licenseUrl);
  assert.equal(font.licenseText, license);
  assert.equal(font.faces[0].dataUrl, `data:font/woff2;base64,${bytes.toString("base64")}`);
  assert.equal(font.faces[0].weight, "400");
  assert.equal(font.faces[0].style, "normal");
  assert.equal((await importFont(input, options())).id, font.id);
  assert.notEqual((await importFont({ ...input, family: "Another Name" }, options())).id, font.id);
});

test("HTML licences are preserved as plain source text without running embedded code", async () => {
  const font = await importFont(input, options(bytes, `<html><script>doNotRun()</script><h1>Licence</h1><p>Use &amp; redistribution terms.</p></html>`, "text/html"));
  assert.equal(font.licenseText, "Licence Use & redistribution terms.");
});

test("import attribution follows verified public redirects and private DNS never reaches a font fetch", async () => {
  const font = await importFont(input, { resolveHost: async () => ["93.184.216.34"], fetch: async url => {
    if (url === input.url) return new Response(null, { status: 302, headers: { Location: "https://cdn.example.com/file" } });
    if (url === input.licenseUrl) return new Response(null, { status: 302, headers: { Location: "https://cdn.example.com/terms" } });
    return new Response(url.endsWith("/file") ? bytes : license, { headers: { "Content-Type": url.endsWith("/file") ? "font/woff2" : "text/plain" } });
  } });
  assert.equal(font.sourceUrl, "https://cdn.example.com/file");
  assert.equal(font.licenseUrl, "https://cdn.example.com/terms");
  await assert.rejects(importFont(input, { resolveHost: async () => ["10.0.0.1"],
    fetch: () => assert.fail("Private DNS must not be fetched"),
  }), error => error.status === 400);
});

test("imports reject unsafe URLs and input before attempting a download", async () => {
  for (const patch of [{ family: "" }, { family: "A".repeat(101) }, { family: "CSS;injection" }, { private: true },
    { url: "http://example.com/font" }, { url: "https://localhost/font" }, { licenseUrl: "https://127.0.0.1/license" }]) {
    await assert.rejects(importFont({ ...input, ...patch }, { fetch: () => assert.fail("Invalid input must not fetch") }), error => error.status === 400);
  }
});

test("imports refuse login HTML, malformed fonts, missing licences and oversized resources", async () => {
  for (const fixture of [options("<html>Please sign in to purchase</html>"), options(new Uint8Array([119, 79, 70, 50])),
    options(bytes, ""), options(bytes, "x".repeat(30001)), options(bytes, '<title>Just a moment...</title>', "text/html"),
    options(bytes, "PDF licence", "application/pdf")])
    await assert.rejects(importFont(input, fixture), error => error.status === 422);
  await assert.rejects(importFont(input, options(new Uint8Array(1024 * 1024 + 1))), error => error.status === 413);
  await assert.rejects(importFont(input, options(bytes, "x".repeat(128 * 1024 + 1))), error => error.status === 413);
});

test("font import route requires same-origin JSON POST and returns non-cached embedded data", async () => {
  const request = (origin = "https://editor.example.com", method = "POST") => new Request("https://editor.example.com/api/fonts/import", {
    method, headers: { Origin: origin, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
    ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
  });
  await assert.rejects(fontsRoute(request("https://other.example.com"), options()), error => error.status === 403);
  await assert.rejects(fontsRoute(request(undefined, "GET"), options()), error => error.status === 405);
  const response = await fontsRoute(request(), options());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).sourceUrl, input.url);
});
