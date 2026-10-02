import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateFontAsset, fontFamily, fontFaceCss, createFontScope } from "../packages/pvo-fonts/index.js";
import { packageManifestFonts, restoreManifestFonts } from "../packages/pvo-fonts/portable.js";
import { readPvoProject, packPvoProject } from "../packages/pvo-sdk/index.js";

const bytes = await readFile(new URL("../editor/src/fonts/peace-sans.woff2", import.meta.url));
const input = {
  id: "test-peace", family: "Peace Sans", sourceUrl: "https://fonts.example/font", licenseUrl: "https://fonts.example/license", licenseText: "Font fixture licence text.",
  faces: [{ dataUrl: `data:font/woff2;base64,${bytes.toString("base64")}`, weight: "400 700", style: "normal", unicodeRange: "U+0000-00FF, U+0131" }],
};

test("font validation creates independent immutable data and safe internal CSS identifiers", () => {
  const font = validateFontAsset(input);
  assert.ok(Object.isFrozen(font));
  assert.ok(Object.isFrozen(font.faces));
  assert.ok(Object.isFrozen(font.faces[0]));
  assert.notEqual(font.faces, input.faces);
  assert.match(fontFamily(font), /^pvo-test-peace-[a-f0-9]+$/);
  assert.equal(fontFamily(font), fontFamily(validateFontAsset(structuredClone(input))));
  assert.match(fontFaceCss(font), /font-weight:400 700/);
  assert.match(fontFaceCss(font), /unicode-range:U\+0000-00FF/);
});

test("fonts reject remote loads, CSS injection, malformed or oversized bytes and descriptors", () => {
  for (const patch of [{ family: 'Test";}body{color:red}' }, { id: "../../font" }, { sourceUrl: "javascript:alert(1)" }, { licenseUrl: "https://user:secret@example.com" }, { faces: [] }, { licenseText: "" }, { licenseText: "X".repeat(30001) }]) {
    assert.throws(() => validateFontAsset({ ...input, ...patch }));
  }
  for (const patch of [{ dataUrl: "https://fonts.example/font.woff2" }, { dataUrl: "data:font/woff2;base64,AAAA" }, { dataUrl: `data:font/woff2;base64,${"A".repeat(1500000)}` }, { weight: "400;src:url(https://bad)" }, { weight: "1001" }, { weight: "700 400" }, { style: "oblique" }, { unicodeRange: "U+0000; }body{color:red}" }]) {
    assert.throws(() => validateFontAsset({ ...input, faces: [{ ...input.faces[0], ...patch }] }));
  }
  const broken = Buffer.from(bytes);
  broken.writeUInt32BE(1, 8);
  assert.throws(() => validateFontAsset({ ...input, faces: [{ ...input.faces[0], dataUrl: `data:font/woff2;base64,${broken.toString("base64")}` }] }), /header/);
});

function manifest(font) {
  return {
    spec_version: "0.1", media: [{ id: "video", asset_id: "video" }], scenes: [{ id: "main", asset_id: "video", start: 0, end: 1 }],
    components: [{ id: "tip", kind: "tooltip", text: "Hello", restyle_capture: { font } }],
    restyle_capture: { scene_layers: { main: { texts: [{ id: 1, text: "Font", style: { fontAsset: font } }] } } },
  };
}

test("portable package deduplicates bytes and restores component and text typography offline", async () => {
  const source = manifest(input);
  const packaged = packageManifestFonts(source);
  assert.equal(packaged.assets.length, 1);
  assert.ok(JSON.stringify(packaged.manifest).length < 2000);
  assert.equal(source.components[0].restyle_capture.font, input);
  const blob = await packPvoProject({ manifest: packaged.manifest, assets: [...packaged.assets, { id: "video", blob: new Blob(["video"]) }] });
  const decoded = await readPvoProject(blob);
  const fonts = await restoreManifestFonts(decoded);
  assert.equal(fonts.length, 1);
  assert.deepEqual(decoded.manifest.components[0].restyle_capture.font, validateFontAsset(input));
  assert.equal(decoded.manifest.components[0].restyle_capture.font, decoded.manifest.restyle_capture.scene_layers.main.texts[0].style.fontAsset);
  const missing = packageManifestFonts(source);
  await assert.rejects(restoreManifestFonts({ manifest: missing.manifest, assets: [] }), /missing/);
  missing.manifest.components[0].restyle_capture.font = { asset_id: "https://evil/font.json" };
  await assert.rejects(restoreManifestFonts({ manifest: missing.manifest, assets: missing.assets }), /reference/);
});

test("font formats must match signatures and complete TrueType/OpenType table bounds", () => {
  const ttf = Buffer.alloc(32);
  ttf.writeUInt32BE(0x00010000, 0);
  ttf.writeUInt16BE(1, 4);
  ttf.write("test", 12);
  ttf.writeUInt32BE(28, 20);
  ttf.writeUInt32BE(4, 24);
  const validate = (type, content) => validateFontAsset({ ...input, faces: [{ ...input.faces[0], dataUrl: `data:font/${type};base64,${content.toString("base64")}` }] });
  assert.match(fontFaceCss(validate("ttf", ttf)), /format\("truetype"\)/);
  assert.throws(() => validate("woff2", ttf), /format/);
  assert.throws(() => validate("ttf", bytes), /format/);
  const otf = Buffer.from(ttf);
  otf.write("OTTO", 0);
  assert.match(fontFaceCss(validate("otf", otf)), /format\("opentype"\)/);
  ttf.writeUInt32BE(100, 20);
  assert.throws(() => validate("ttf", ttf), /incomplete/);
});

test("font scopes release owned faces, ignore a late load after disposal, and permit retry after rejection", async () => {
  const active = new Set();
  const pending = [];
  class Font {
    constructor(family, source) { assert.ok(source instanceof Uint8Array); this.family = family; }
    load() { return new Promise((resolve, reject) => pending.push({ resolve: () => resolve(this), reject })); }
  }
  const doc = { defaultView: { FontFace: Font }, fonts: { add: font => active.add(font), delete: font => active.delete(font) } };
  const scope = createFontScope(doc);
  const first = scope.load(input);
  pending.shift().reject(new Error("decode failed"));
  await assert.rejects(first, /Could not load font Peace Sans/);
  const second = scope.load(input);
  pending.shift().resolve();
  await second;
  assert.equal(active.size, 1);
  scope.dispose();
  assert.equal(active.size, 0);
  const late = createFontScope(doc);
  const loading = late.load(input);
  late.dispose();
  pending.shift().resolve();
  await loading;
  assert.equal(active.size, 0);
});
