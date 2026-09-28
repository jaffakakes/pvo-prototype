import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [fileURLToPath(new URL("../editor/src/features/component-authoring/language/highlightPvo.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
});
const { tokenizePvo } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function kindOf(source, part, text) {
  const start = source.indexOf(text);
  assert.notEqual(start, -1, `Fixture must contain ${text}`);
  let offset = 0;
  const overlapping = tokenizePvo(source, part).filter(token => {
    const end = offset + token.text.length;
    const overlaps = offset < start + text.length && end > start;
    offset = end;
    return overlaps;
  });
  return [...new Set(overlapping.map(token => token.kind))];
}

const examples = {
  structure: '<choice>\r\n  <prompt>{{prompt}} &amp; café 🌍</prompt>\n  <option id="street">A &lt; B</option>\n</choice>',
  style: '#street { color: #f2f0e9; border-radius: 12px; background: rgba(10, 20, 30, .5); }\n',
  logic: 'on choose(street) { request({"url":"https://example.com", "body":"{\\"ok\\":true}", "onError":null}); }\n',
};

test("every complete or incomplete edit preserves the exact source", () => {
  for (const [part, source] of Object.entries(examples)) {
    for (let end = 0; end <= source.length; end++) {
      const draft = source.slice(0, end);
      const tokens = tokenizePvo(draft, part);
      assert.equal(tokens.map(token => token.text).join(""), draft, `${part} prefix ${end}`);
      assert.ok(tokens.every(token => token.text.length > 0));
    }
  }
});

test("malformed or malicious-looking input stays literal data in every section", () => {
  const inputs = [
    '</textarea><script>globalThis.__pvoHighlightExecuted = true</script>',
    '<field name="x<img src=x onerror=alert(1)>" kind=\'email\' />',
    '"\\"<script>\\\\" : { unclosed: true,',
    '\u0000\t\r\n<&>\'"{{ incomplete 😀 e\u0301 \ud800',
    '@import url("https://example.com/<asset>"); /* unfinished',
    '<<<&&&& {{{{{ \\\\ "" \'\'',
  ];
  for (const part of Object.keys(examples)) for (const source of inputs) {
    assert.equal(tokenizePvo(source, part).map(token => token.text).join(""), source);
  }
  assert.equal(globalThis.__pvoHighlightExecuted, undefined);
});

test("Structure distinguishes tags, attributes, strings, entities, and Field placeholders", () => {
  const source = '<option id="street" label=\'{{options[0].label}} &amp;\'>{{prompt}} &lt; 3 &#39;</option>';
  assert.deepEqual(kindOf(source, "structure", "option"), ["tag"]);
  assert.deepEqual(kindOf(source, "structure", "id"), ["attribute"]);
  assert.deepEqual(kindOf(source, "structure", '"street"'), ["string"]);
  for (const token of ["{{options[0].label}}", "{{prompt}}", "&amp;", "&lt;", "&#39;"]) {
    assert.deepEqual(kindOf(source, "structure", token), ["template"]);
  }
});

test("Structure text and quoted attribute content cannot open highlighting tags", () => {
  const source = '<text note="<script> is data">2 < 3 and "quoted prose"</text>';
  assert.deepEqual(kindOf(source, "structure", "<script> is data"), ["string"]);
  assert.deepEqual(kindOf(source, "structure", "2 < 3"), ["plain"]);
  assert.deepEqual(kindOf(source, "structure", '"quoted prose"'), ["plain"]);
  assert.deepEqual(kindOf('<field name="unfinished <tag', "structure", "unfinished <tag"), ["string"]);
});

test("Style distinguishes selector IDs from hex colors and includes numeric units", () => {
  const source = 'prompt { font-size: 18px; color: #abc; background: rgba(1, 2, 3, .5); text-align: center; }\n#abc { border-radius: 4px; }';
  assert.deepEqual(kindOf(source, "style", "prompt"), ["selector"]);
  assert.deepEqual(kindOf(source, "style", "font-size"), ["property"]);
  assert.deepEqual(kindOf(source, "style", "18px"), ["number"]);
  assert.deepEqual(kindOf(source, "style", "#abc"), ["number"]);
  assert.deepEqual(kindOf(source, "style", "rgba"), ["function"]);
  assert.deepEqual(kindOf(source, "style", ".5"), ["number"]);
  assert.deepEqual(kindOf(source, "style", "center"), ["keyword"]);
  assert.deepEqual(kindOf('#street { color: #fff; }', "style", "#street"), ["selector"]);
  assert.deepEqual(kindOf('#abc { color: #fff; }', "style", "#abc"), ["selector"]);
});

test("Logic highlights event and action words, JSON keys, numbers, and literal keywords", () => {
  const source = 'on submit { request({ "url": "https://example.com", "onError": null, "body": "", "ok": true, "bad": false, "t": -1.25e+2 }); }';
  for (const word of ["on", "submit", "null", "true", "false"]) assert.deepEqual(kindOf(source, "logic", word), ["keyword"]);
  assert.deepEqual(kindOf(source, "logic", "request"), ["function"]);
  assert.deepEqual(kindOf(source, "logic", '"url"'), ["property"]);
  assert.deepEqual(kindOf(source, "logic", '"https://example.com"'), ["string"]);
  assert.deepEqual(kindOf(source, "logic", "-1.25e+2"), ["number"]);
  assert.deepEqual(kindOf('on choose(street) { jump_to(3); }', "logic", "choose"), ["keyword"]);
  assert.deepEqual(kindOf('on choose(street) { jump_to(3); }', "logic", "jump_to"), ["function"]);
});

test("Logic keeps escaped JSON strings and HTML-like text in their string context", () => {
  const value = JSON.stringify('{"name":"<script>","path":"C:\\clips", "valid":true}');
  const source = `on submit { request({"body": ${value}, "onError": null}); }`;
  assert.deepEqual(kindOf(source, "logic", value), ["string"]);
  assert.deepEqual(kindOf(source, "logic", '"onError"'), ["property"]);
  assert.deepEqual(kindOf('go_to_scene("<tag> on true \\\" still string")', "logic", '<tag> on true'), ["string"]);
  assert.deepEqual(kindOf('request({"body":"trailing\\', "logic", '"trailing\\'), ["string"]);
});
