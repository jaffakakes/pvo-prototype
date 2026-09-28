import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/domain/components/languageSource.ts"],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { generatePvoLanguageSource } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("Advanced starters show editable visual rules for every component", () => {
  const examples = [
    { type: "tooltip", fields: { text: "Hint" }, selectors: ["tooltip", "text"] },
    { type: "card", fields: { title: "Title", body: "Body", buttons: [{ label: "Open" }] }, selectors: ["card", "title", "body", "button"] },
    { type: "choice", fields: { prompt: "Pick one", options: [{ label: "One" }, { label: "Two" }] }, selectors: ["choice", "prompt", "option"] },
    { type: "form", fields: { fieldKinds: ["name"], submitLabel: "Send" }, selectors: ["form", "field", "submit"] },
  ];
  for (const example of examples) {
    const source = generatePvoLanguageSource(example);
    assert.ok(source.structure.startsWith(`<${example.type}>`));
    for (const selector of example.selectors)
      assert.match(source.style, new RegExp(`(?:^|\\n)${selector} \\{`), `${example.type} needs a ${selector} style starter`);
    assert.match(source.style, /background: #[0-9A-F]{3,8};/);
  }
});

test("starter Logic names only the controls that exist", () => {
  const tooltip = generatePvoLanguageSource({ type: "tooltip", fields: { text: "Hint" } });
  assert.equal(tooltip.logic, "", "Tooltip must remain display-only");

  const emptyCard = generatePvoLanguageSource({ type: "card", fields: { title: "Title", buttons: [] } });
  assert.equal(emptyCard.logic, "", "A Card without buttons has no press event");
  assert.doesNotMatch(emptyCard.style, /^button \{/m);

  const card = generatePvoLanguageSource({ type: "card", fields: { title: "Title", buttons: [
    { label: "Go", outcome: { kind: "time", t: 3 } },
    { label: "Next", outcome: { kind: "continue" } },
  ] } });
  assert.match(card.logic, /on press\(button0\) \{\n  jump_to\(3\);\n\}/);
  assert.match(card.logic, /on press\(button1\) \{\n  continue\(\);\n\}/);

  const choice = generatePvoLanguageSource({ type: "choice", fields: { options: [
    { label: "One", outcome: { kind: "continue" } },
    { label: "Two", outcome: { kind: "continue" } },
  ] } });
  assert.equal((choice.logic.match(/on choose\(/g) ?? []).length, 2);

  const form = generatePvoLanguageSource({ type: "form", fields: { fieldKinds: ["email"], submitLabel: "Send" } });
  assert.match(form.logic, /^on submit \{\n  continue\(\);\n\}$/);
});
