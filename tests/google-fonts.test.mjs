import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseCatalogue, searchFontCatalogue } from "../server/fonts/catalogue.js";
import { downloadFont, parseFontStylesheet } from "../server/fonts/download.js";
import { fontBytes } from "../server/fonts/upstream.js";
import { validateFontAsset, MAX_FONT_BYTES } from "../packages/pvo-fonts/index.js";

const bytes = await readFile(new URL("../editor/src/fonts/peace-sans.woff2", import.meta.url));
const metadata = items => `)]}'\n${JSON.stringify({ familyMetadataList: items })}`;
const family = (name = "Example Sans", popularity = 5) => ({ family: name, category: "Sans Serif", popularity,
  isOpenSource: true, fonts: { "400": {}, "400i": {}, "700": {} } });
const face = (url = "https://fonts.gstatic.com/s/example/v1/regular.woff2", weight = "400") => `@font-face {
  font-family: 'Example Sans'; font-style: normal; font-weight: ${weight};
  src: url('${url}') format('woff2'); unicode-range: U+0000-00FF;
}`;
function fixture({ items = [family()], css = face(), font = bytes, licence = "SIL OPEN FONT LICENSE Version 1.1", oflStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    const host = new URL(url).hostname;
    if (host === "fonts.google.com") return new Response(metadata(items));
    if (host === "fonts.googleapis.com") return new Response(css);
    if (host === "fonts.gstatic.com") return new Response(font);
    assert.equal(host, "raw.githubusercontent.com");
    return url.includes("/ofl/") && oflStatus !== 200
      ? new Response("private provider response", { status: oflStatus }) : new Response(licence);
  };
  return { calls, fetch };
}

test("Google catalogue accepts the actual anti-XSSI envelope and filters non-open or unsafe families", () => {
  const fonts = parseCatalogue(metadata([family(), { ...family("Paid Face"), isOpenSource: false },
    { ...family("Invalid;family") }, { ...family("Missing fonts"), fonts: null },
    { ...family("Variable Face"), axes: [{ tag: "wght", min: 100, max: 900 }] },
  ]));
  assert.deepEqual(fonts.map(font => font.id), ["google-example-sans", "google-variable-face"]);
  assert.deepEqual(fonts[0].weights, [400, 700]);
  assert.deepEqual(fonts[1].weightAxis, { tag: "wght", min: 100, max: 900 });
  assert.throws(() => parseCatalogue('{"familyMetadataList":{}}'), error => error.status === 502);
});

test("catalogue search combines family/category terms, ranks results and caps the list at 24", async () => {
  const source = fixture({ items: Array.from({ length: 30 }, (_, index) => family(`Example ${index}`, 30 - index)) });
  const fonts = await searchFontCatalogue(" eXample SANS ", source);
  assert.equal(fonts.length, 24);
  assert.equal(fonts[0].family, "Example 29");
  assert.deepEqual(Object.keys(fonts[0]).sort(), ["category", "family", "id"]);
  assert.deepEqual(await searchFontCatalogue("not-in-catalogue", source), []);
});

test("Google stylesheets accept only bounded gstatic WOFF2 descriptors", () => {
  const descriptors = parseFontStylesheet(face());
  assert.deepEqual(descriptors, [{ url: "https://fonts.gstatic.com/s/example/v1/regular.woff2",
    weight: "400", style: "normal", unicodeRange: "U+0000-00FF" }]);
  for (const url of ["http://fonts.gstatic.com/s/a.woff2", "https://attacker.com/s/a.woff2",
    "https://fonts.gstatic.com.attacker.com/s/a.woff2", "https://fonts.gstatic.com/s/a.woff2?token=private",
    "https://fonts.gstatic.com/s/a.woff2#fragment", "https://fonts.gstatic.com/other/a.woff2",
    "https://fonts.gstatic.com/s/a.ttf", "data:font/woff2;base64,AAAA"])
    assert.throws(() => parseFontStylesheet(face(url)), error => error.status === 502, url);
  assert.throws(() => parseFontStylesheet(face().repeat(33)), error => error.status === 413);
  assert.throws(() => parseFontStylesheet("body { font-family: serif; }"), error => error.status === 413);
});

test("Google download embeds actual WOFF2 bytes, requested weights and complete licence attribution", async () => {
  const source = fixture({ css: `${face()}\n${face(undefined, "700")}` });
  const font = await downloadFont("google-example-sans", source);
  assert.deepEqual(validateFontAsset(font), font);
  assert.equal(font.family, "Example Sans");
  assert.equal(font.faces.length, 2);
  assert.equal(font.faces[0].dataUrl, `data:font/woff2;base64,${bytes.toString("base64")}`);
  assert.equal(font.licenseText, "SIL OPEN FONT LICENSE Version 1.1");
  assert.equal(font.sourceUrl, "https://fonts.google.com/specimen/Example%20Sans");
  assert.equal(font.licenseUrl, "https://github.com/google/fonts/blob/main/ofl/examplesans/OFL.txt");
  assert.equal(source.calls.filter(call => new URL(call.url).hostname === "fonts.gstatic.com").length, 1,
    "Repeated descriptors share the same real download");
  const css = source.calls.find(call => new URL(call.url).hostname === "fonts.googleapis.com");
  assert.equal(new URL(css.url).searchParams.get("family"), "Example Sans:wght@400;700");
});

test("variable family ranges and fallback licence locations are requested through fixed provider URLs", async () => {
  const source = fixture({ items: [{ ...family(), axes: [{ tag: "wght", min: 100, max: 900 }] }],
    css: face(undefined, "100 900"), licence: "Apache License Version 2.0", oflStatus: 404 });
  const font = await downloadFont("google-example-sans", source);
  assert.equal(font.faces[0].weight, "100 900");
  assert.equal(font.licenseUrl, "https://github.com/google/fonts/blob/main/apache/examplesans/LICENSE.txt");
  const css = source.calls.find(call => new URL(call.url).hostname === "fonts.googleapis.com");
  assert.equal(new URL(css.url).searchParams.get("family"), "Example Sans:wght@100..900");
});

test("missing catalogue IDs, invalid bytes, licence failure and the 1 MiB limit cannot yield a saved font", async () => {
  await assert.rejects(downloadFont("google-missing", fixture()), error => error.status === 404);
  await assert.rejects(downloadFont("google-example-sans", fixture({ font: "<html>Sign in</html>" })), error => error.status === 502);
  await assert.rejects(downloadFont("google-example-sans", fixture({ font: Buffer.alloc(MAX_FONT_BYTES + 1) })), error => error.status === 413);
  await assert.rejects(downloadFont("google-example-sans", fixture({ licence: "private unavailable page" })), error =>
    error.status === 502 && !error.message.includes("private"));
  const broken = Buffer.from(bytes);
  broken.writeUInt32BE(1, 8);
  await assert.rejects(downloadFont("google-example-sans", fixture({ font: broken })), /Font header is invalid/);
});

test("fixed font transport rejects redirects and cancels oversized streams without forwarding private response text", async () => {
  let calls = 0;
  await assert.rejects(fontBytes("https://fonts.gstatic.com/s/a.woff2", 100, { fetch: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    return new Response("private provider redirect", { status: 302, headers: { Location: "https://attacker.com/font" } });
  } }), error => error.status === 502 && !error.message.includes("private"));
  assert.equal(calls, 1);
  let cancelled = false;
  await assert.rejects(fontBytes("https://fonts.gstatic.com/s/a.woff2", 2, { fetch: async () =>
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3)); }, cancel() { cancelled = true; } })),
  }), error => error.status === 413);
  assert.equal(cancelled, true);
});
