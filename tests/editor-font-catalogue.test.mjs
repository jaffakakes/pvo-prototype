import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";

const bundled = buildSync({ entryPoints: ["editor/src/infrastructure/fonts/catalogue.ts"], bundle: true,
  write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const bytes = await readFile(new URL("../editor/src/fonts/peace-sans.woff2", import.meta.url));
const font = { id: "web-fixture", family: "Web Fixture", sourceUrl: "https://foundry.example/font.woff2",
  licenseUrl: "https://foundry.example/licence", licenseText: "Fixture licence.",
  faces: [{ dataUrl: `data:font/woff2;base64,${bytes.toString("base64")}`, style: "normal", weight: "400" }] };

function response(t, value, status = 200) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return Response.json(value, { status });
  });
  return calls;
}

test("font web search uses the general search endpoint and retains source evidence", async t => {
  const source = { title: "Independent Foundry", url: "https://foundry.example/", snippet: "<b>Plain-text evidence</b>" };
  const calls = response(t, { results: [source] });
  assert.deepEqual(await api.searchFontSources("  geometric fonts independent foundry  "), [source]);
  assert.equal(calls[0].url, "/api/web/search?q=geometric%20fonts%20independent%20foundry");
  assert.equal(calls[0].options.credentials, "same-origin");
});

test("web font sources reject unsafe links and excessive results before rendering", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ results: [
    { title: "Unsafe", url: "javascript:alert(1)", snippet: "Do not render a dangerous link." },
  ] }));
  await assert.rejects(api.searchFontSources("fonts"), /HTTPS/);
  fetch.mock.mockImplementation(async () => Response.json({ results: Array(11).fill({ title: "Font", url: "https://example.com", snippet: "" }) }));
  await assert.rejects(api.searchFontSources("fonts"), /could not be read/);
});

test("Google Fonts remains an explicit separate catalogue", async t => {
  const calls = response(t, { fonts: [{ id: "google-peace", family: "Peace", category: "sans-serif" }] });
  assert.equal((await api.searchGoogleFonts("Peace"))[0].family, "Peace");
  assert.equal(calls[0].url, "/api/fonts/search?q=Peace");
  await assert.rejects(api.searchGoogleFonts("x".repeat(101)), /100 characters/);
  assert.equal(calls.length, 1, "The catalogue never silently truncates a long web query");
});

test("direct font import posts explicit attribution and validates embedded font bytes", async t => {
  const calls = response(t, font);
  const input = { family: font.family, url: font.sourceUrl, licenseUrl: font.licenseUrl };
  assert.equal((await api.importFontUrl(input)).id, font.id);
  assert.equal(calls[0].url, "/api/fonts/import");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), input);
  const fetch = globalThis.fetch;
  fetch.mock.mockImplementation(async () => Response.json({ ...font, faces: [{ ...font.faces[0], dataUrl: "https://foundry.example/remote.woff2" }] }));
  await assert.rejects(api.importFontUrl(input), /embedded/);
});

test("direct import rejects malformed input before requesting a remote download", async t => {
  const calls = response(t, font);
  for (const input of [
    { family: "Bad; font", url: font.sourceUrl, licenseUrl: font.licenseUrl },
    { family: font.family, url: "http://foundry.example/font.woff2", licenseUrl: font.licenseUrl },
    { family: font.family, url: font.sourceUrl, licenseUrl: "https://user:password@foundry.example/licence" },
  ]) await assert.rejects(api.importFontUrl(input));
  assert.equal(calls.length, 0);
});

test("font file shortcuts recognise all supported formats without confusing source pages", () => {
  for (const extension of ["woff2", "woff", "TTF", "otf"])
    assert.equal(api.isFontFileUrl(`https://foundry.example/font.${extension}?download=1`), true);
  for (const url of ["https://foundry.example/fonts", "javascript:font.woff2", "http://foundry.example/font.ttf"])
    assert.equal(api.isFontFileUrl(url), false);
});

test("import HTTP failures hide arbitrary response content", async t => {
  response(t, { error: "Provider internals and unrelated private detail" }, 400);
  await assert.rejects(api.importFontUrl({ family: font.family, url: font.sourceUrl, licenseUrl: font.licenseUrl }),
    error => !error.message.includes("Provider internals") && error.message.includes("Check its file and licence URLs"));
});
