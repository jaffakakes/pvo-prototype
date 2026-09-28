import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { initSync } from "../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../packages/pvo-language/index.js";

initSync({ module: new WebAssembly.Module(await readFile(new URL("../packages/pvo-language/pkg/pvo_language_bg.wasm", import.meta.url))) });
const bundled = buildSync({ entryPoints: ["editor/src/domain/components/languageFormatting.ts"],
  bundle: true, write: false, format: "esm", platform: "browser" });
const { formatPvoPart, formatPvoSource } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("Structure adds only inter-element layout, retaining literal wording and attributes", async () => {
  const leaf = '<body>  Keep  two spaces\r\nline two 😀 &amp; &lt;code&gt; {{literal}}  </body>';
  const source = { structure: `<card> <title>One</title>${leaf}<button id='primary' >Next &quot;step&quot;</button></card>`,
    style: "card{background:#123456;color:rgba(12, 34, 56, .5);}", logic: "on press(primary){continue();}" };
  const formatted = formatPvoSource(source);
  assert.equal(formatted.structure, `<card>\n  <title>One</title>\n  ${leaf}\n  <button id='primary' >Next &quot;step&quot;</button>\n</card>`);
  assert.deepEqual(await compilePvoComponent("card", formatted), await compilePvoComponent("card", source));
  assert.deepEqual(formatPvoSource(formatted), formatted);
});

test("form formatting preserves attribute order, quotes, entities and literal greater-than signs", async () => {
  const field = `<field label='A > B &apos; 😀' kind="short" name='custom_name'/>`;
  const submit = `<submit waiting='Sending > now'>Send</submit>`;
  const source = { structure: `<form>${field}${submit}</form>`, style: "", logic: "on submit{continue();}" };
  const formatted = formatPvoSource(source);
  assert.equal(formatted.structure, `<form>\n  ${field}\n  ${submit}\n</form>`);
  assert.deepEqual(await compilePvoComponent("form", formatted), await compilePvoComponent("form", source));
});

test("Style preserves cascade order, aliases, duplicate declarations and value spellings", async () => {
  const source = { structure: "<card><title>Title</title><button id='primary'>Go</button></card>",
    style: "#primary{font-size:023.0px;color:#FfF;}button{background-color:rgba(000, 20, 255, .500);font-weight:700;}card{color:#abc;color:currentColor;}",
    logic: "on press(primary){continue();}" };
  const formatted = formatPvoSource(source);
  assert.equal(formatted.style, "#primary {\n  font-size: 023.0px;\n  color: #FfF;\n}\n\nbutton {\n  background-color: rgba(000, 20, 255, .500);\n  font-weight: 700;\n}\n\ncard {\n  color: #abc;\n  color: currentColor;\n}");
  assert.deepEqual(await compilePvoComponent("card", formatted), await compilePvoComponent("card", source));
  assert.deepEqual(formatPvoSource(formatted), formatted);
});

test("Logic formats handlers without rewriting JSON strings, escapes or numeric tokens", async () => {
  const body = JSON.stringify(JSON.stringify({ message: 'keep } { , ; : "quoted" and \\slashes 😀', path: "{state.form.component.contact}" }));
  const url = String.raw`"https:\/\/api.example.com\/capture?x=1&next=%7Btoken%7D"`;
  const scene = String.raw`"scene-\u0032"`;
  const request = `{"url":${url},"method":"POST","body":${body},"onSuccess":{"kind":"time","t":1.2500e+0},"onError":{"kind":"scene","sceneId":${scene}}}`;
  const source = { structure: '<card><title>Request</title><button id="primary">Send</button><button id="other">Next</button></card>',
    style: "", logic: `on press(primary){request(${request});}on press(other){jump_to(0001.50);}` };
  const formatted = formatPvoSource(source);
  assert.ok(formatted.logic.includes(`    "url": ${url},`));
  assert.ok(formatted.logic.includes(`    "body": ${body},`));
  assert.ok(formatted.logic.includes('      "t": 1.2500e+0'));
  assert.ok(formatted.logic.includes(`      "sceneId": ${scene}`));
  assert.match(formatted.logic, /\n\non press\(other\) \{\n  jump_to\(0001\.50\);\n\}$/);
  assert.deepEqual(await compilePvoComponent("card", formatted), await compilePvoComponent("card", source));
  assert.deepEqual(formatPvoSource(formatted), formatted);
});

test("all component kinds retain compiler output and formatting is immutable/idempotent", async () => {
  const fixtures = [
    ["tooltip", { structure: "<tooltip><text>Note</text></tooltip>", style: "tooltip{color:#123;}text{font-weight:800;}", logic: "" }],
    ["choice", { structure: '<choice><prompt>Choose</prompt><option id="left">Left</option><option id="right">Right</option></choice>',
      style: "choice{border-radius:0;}#left{color:#abc;}", logic: 'on choose(left){go_to_scene("scene-2");}on choose(right){continue();}' }],
  ];
  for (const [kind, source] of fixtures) {
    const original = { ...source };
    Object.freeze(source);
    const formatted = formatPvoSource(source);
    assert.deepEqual(source, original);
    assert.notEqual(formatted, source);
    assert.deepEqual(formatPvoSource(formatted), formatted);
    assert.deepEqual(await compilePvoComponent(kind, formatted), await compilePvoComponent(kind, source));
  }
});

test("unfinished, commented, foreign or malformed syntax stays byte-for-byte unchanged", () => {
  const fixtures = {
    structure: [
      "<card><title>Typing", "<card><title></title></card>", "<card><title>A</body></card>",
      "<card><!-- comment --><title>A</title></card>", "<card><title><strong>A</strong></title></card>",
      '<form><field name="unfinished', "<card><title>&unknown;</title></card>",
      "<script>alert(1)</script>", "<card onclick='run()'><title>A</title></card>",
      '<choice><option id="a">A</option><option id="b">B</option></choice>',
      '<form><field name="a" kind="short"/><field name="a" kind="short"/><submit>Go</submit></form>',
      '<card><title>A</title><button id="constructor">Go</button></card>',
    ],
    style: ["card{color:#fff", "card{color:#fff}", "card{}", "card{color:#fff;/*comment*/}",
      "card{background:url(https://example.com);}", "body{font-size:999px;}", "script{color:#fff;}",
      "#primary:hover{color:#fff;}", "card,title{color:#fff;}", "card{color:#fff;} unclosed"],
    logic: ["on press(primary){", "on press(primary){continue()}", "// comment\non submit{continue();}",
      "on submit{alert(1);}", "on submit{continue();continue();}", 'on submit{request({"body":"oops});}',
      'on submit{request({"body":"a",});}', 'on submit{request({"n":01});}',
      String.raw`on submit{go_to_scene("bad\q");}`, "on submit{continue();} trailing",
      "on submit{continue();}on submit{continue();}", "on submit{jump_to(1.2.3);}"],
  };
  for (const [part, values] of Object.entries(fixtures))
    for (const value of values) assert.equal(formatPvoPart(part, value), value, `${part}: ${value}`);
});

test("formatting recognises compiler whitespace without changing CRLF inside literals", async () => {
  const source = { structure: '<tooltip>\u0085<text>first\r\nsecond</text>\u0085</tooltip>',
    style: "tooltip\u0085{\r\ncolor:\u0085#fff;\u0085}", logic: "\r\n" };
  const formatted = formatPvoSource(source);
  assert.equal(formatted.structure, "<tooltip>\n  <text>first\r\nsecond</text>\n</tooltip>");
  assert.equal(formatted.style, "tooltip {\n  color: #fff;\n}");
  assert.deepEqual(await compilePvoComponent("tooltip", formatted), await compilePvoComponent("tooltip", source));
  assert.equal(formatPvoPart("logic", "on\u0085submit{continue();}"), "on\u0085submit{continue();}");
});

test("formatter does not grow a section beyond the compiler byte limit", () => {
  const value = `<tooltip><text>${"a".repeat(19967)}</text></tooltip>`;
  assert.equal(Buffer.byteLength(value), 19999);
  assert.equal(formatPvoPart("structure", value), value);
  const oversized = `<tooltip><text>${"😀".repeat(5000)}</text></tooltip>`;
  assert.equal(formatPvoPart("structure", oversized), oversized);
});

test("formatting preserves a valid request when indentation would exceed its separate JSON limit", async () => {
  const action = { url: "https://api.example.com", method: "POST", body: JSON.stringify({ message: '"'.repeat(2800) }),
    onSuccess: { kind: "continue" }, onError: null };
  const targetBytes = 11990;
  const padding = targetBytes - Buffer.byteLength(JSON.stringify(action));
  action.body = action.body.replace('"message":"', `"message":"${"x".repeat(padding)}`);
  assert.equal(Buffer.byteLength(JSON.stringify(action)), targetBytes);
  const logic = `on submit{request(${JSON.stringify(action)});}`;
  const source = { structure: '<form><field name="answer" kind="short"/><submit>Send</submit></form>', style: "", logic };
  await compilePvoComponent("form", source);
  assert.equal(formatPvoPart("logic", logic), logic);
});
