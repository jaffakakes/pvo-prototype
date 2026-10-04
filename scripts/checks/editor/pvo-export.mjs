import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";

// Run against `npm run dev:editor`; a demo clip keeps this check independent
// of camera hardware while still exercising the real canvas/media exporter.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

try {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { exportPvo } = await import("/src/features/export/exportPvo.ts");
    const { compileLanguages } = await import("/src/infrastructure/language/compileProject.ts");
    const { acceptComponentCompilation } = await import("/src/state/components/componentLanguageCommands.ts");
    const state = useCapture.getState();
    state.patch({ clips: [mkClip(2, null, 0)], screen: "editor", t: 0 });
    const id = useCapture.getState().addComponent("choice");
    useCapture.getState().updateComponent(id, {
      code: {
        custom: true,
        pvo: {
          structure: '<choice><prompt>Language prompt</prompt><option id="first">First from Structure</option><option id="second">Second from Structure</option></choice>',
          style: "option { color: #111; }",
          logic: "on choose(first) { continue(); } on choose(second) { continue(); }",
        },
      },
    });
    const authored = useCapture.getState().components.find(component => component.id === id);
    acceptComponentCompilation(authored, (await compileLanguages(useCapture.getState())).get(id).compiled);
    const synchronized = useCapture.getState().components.find(component => component.id === id);
    useCapture.getState().updateComponent(id, { fields: {
      ...synchronized.fields,
      prompt: "Round-trip {{title}} & <prompt>",
      options: synchronized.fields.options.map((option, index) => index === 0
        ? { ...option, label: "Edited in Fields" } : option),
    } });
    useCapture.getState().updateOutcome(id, { kind: "option", index: 0 }, { kind: "time", t: 0.5 });
    const current = useCapture.getState().components.find(component => component.id === id);
    let invalidDraftError = "";
    try {
      await compileLanguages({ scenes: [{ ...useCapture.getState().scenes[0], components: [{
        ...current,
        code: { ...current.code, custom: false, pvoTouched: true,
          pvo: { ...current.code.pvo, structure: "<choice>unfinished" } },
      }] }] });
    } catch (error) { invalidDraftError = error.message; }
    const fieldId = useCapture.getState().addComponent("tooltip");
    useCapture.getState().updateComponent(fieldId, {
      fields: { text: "No-code tooltip" },
    });
    const cardId = useCapture.getState().addComponent("card");
    useCapture.getState().updateComponent(cardId, {
      fields: { title: "No-code title", body: "From Fields", buttons: [
        { label: "Okay", outcome: { kind: "continue" } },
      ] },
    });
    const formId = useCapture.getState().addComponent("form");
    useCapture.getState().updateOutcome(formId, { kind: "form" }, {
      kind: "request", url: "https://api.example.com/submit", method: "POST", body: "{}",
      onSuccess: { kind: "continue" }, onError: null,
    });
    const exported = await exportPvo(useCapture.getState(), () => {});
    try {
      const blob = await fetch(exported.url).then(response => response.blob());
      useCapture.getState().updateComponent(fieldId, { code: { custom: true } });
      let olderFormatError = "";
      try { await exportPvo(useCapture.getState(), () => {}); }
      catch (error) { olderFormatError = error.message; }
      return {
        fileName: exported.name,
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        olderFormatError,
        invalidDraftError,
      };
    } finally {
      URL.revokeObjectURL(exported.url);
    }
  });

  const decoded = await readPvoProject(new Blob([Uint8Array.from(result.bytes)], { type: "application/vnd.pvo" }));
  const component = decoded.manifest.components[0];
  const fieldComponent = decoded.manifest.components[1];
  const cardComponent = decoded.manifest.components[2];
  const formComponent = decoded.manifest.components[3];
  const assets = new Map(decoded.assets.map(asset => [asset.id, asset]));
  const language = component.restyle_capture.code.language;
  const structure = await assets.get(language.structure)?.blob.text();
  assert.equal(result.fileName, "restyle-video.pvo");
  assert.equal(decoded.validation.valid, true);
  assert.equal(component.title, "Round-trip {{title}} & <prompt>");
  assert.deepEqual(component.options.map(option => option.label), ["Edited in Fields", "Second from Structure"]);
  assert.equal(component.options[0].action.type, "seek");
  assert.equal(component.options[0].action.time, 0.5);
  assert.equal(language.version, 1);
  assert.match(structure, /<prompt>Round-trip \{\{title\}\} &amp; &lt;prompt&gt;<\/prompt>/);
  assert.match(structure, /<option id="first">Edited in Fields<\/option>/);
  assert.equal(await assets.get(language.style)?.blob.text(), "option { color: #111; }");
  assert.equal(component.restyle_capture.code.html, undefined);
  assert.equal(component.restyle_capture.code.css, undefined);
  assert.equal(component.restyle_capture.code.js, undefined);
  assert.equal(fieldComponent.text, "No-code tooltip");
  assert.equal(fieldComponent.restyle_capture.code, undefined,
    "Visual components should use their native manifest presentation without a code runtime");
  assert.equal(cardComponent.title, "No-code title");
  assert.equal(cardComponent.actions[0].label, "Okay");
  assert.equal(cardComponent.actions[0].action.type, "custom");
  assert.equal(formComponent.on_submit.type, "request");
  assert.deepEqual(decoded.manifest.allowed_domains, ["api.example.com"]);
  assert.equal([...assets.keys()].filter(path => /\.(?:html|css|js)$/.test(path)).length, 0);
  assert.match(result.olderFormatError, /older HTML\/CSS\/JavaScript component cannot be exported/);
  assert.ok(result.invalidDraftError, "Export must reject the first invalid Advanced draft");
  assert.equal(decoded.assets.length, 13);
  assert.deepEqual(errors, []);
  console.log("PVO language export passed: real media package, authored code and visual Fields, semantic manifest, no legacy code assets.");
} finally {
  await browser.close();
}
