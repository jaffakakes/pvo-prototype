import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/features/assistant/AssistantContext.tsx"],
  bundle: true, write: false, format: "esm", platform: "browser",
  outfile: "assistant-context-test.js",
});
const script = bundled.outputFiles.find(file => file.path.endsWith(".js"));
const { AssistantContext } = await import(
  `data:text/javascript;base64,${Buffer.from(script.text).toString("base64")}`);

function miniatureStyle(style, pending = false) {
  const component = {
    id: "card", sceneId: "main", type: "card", at: 0, dur: 3, x: 50, y: 50,
    fields: { title: "Card", body: "Body", buttons: [{ label: "Go" }] },
    code: { custom: true, pvoTouched: pending, pvo: { structure: "", style, logic: "" },
      pvoLastValid: { structure: "", style: "", logic: "" },
      pvoCompiled: { structure: { type: "card", title: "Card", body: "Body",
        buttons: [{ id: "primary", label: "Go" }] }, rules: [] } },
  };
  const rendered = AssistantContext({ component, voiceSupported: true, modeLabel: "Local preview" });
  const miniature = rendered.props.children.find(child => child.props?.["data-assistant-context-preview"]);
  assert(miniature, "The context must expose the selected component's visual cue");
  return miniature.props.style;
}

test("assistant miniature follows final authored colours, radius and control aliases", () => {
  const style = miniatureStyle(`card { background: #111; color: #fff; border-radius: 24px; }
    #primary { background: #123456; }
    card { background-color: #60A5FA; border-radius: 6px; }
    button { background-color: #DCD2F5; }`);
  assert.equal(style.background, "#60A5FA");
  assert.equal(style.color, "#fff");
  assert.equal(style.borderRadius, 2);
  assert.equal(style["--mini-button"], "#DCD2F5");
});

test("uncompiled source cannot inject resources or arbitrary CSS through the miniature", () => {
  const baseline = miniatureStyle("");
  const unsafe = miniatureStyle(`card {
    background: url(https://untrusted.example/pixel);
    color: var(--private-colour);
    border-color: image-set(url(https://untrusted.example/border));
    border-radius: calc(100vw);
  }
  #primary { background: url(https://untrusted.example/button); }`, true);
  assert.deepEqual(unsafe, baseline,
    "Unsafe draft values must use the known component look before reaching host styles");
});

test("assistant miniature preserves safe translucent and transparent authored colours", () => {
  const style = miniatureStyle("card { background: rgba(21, 21, 28, .5); color: #1234; border-color: transparent; }");
  assert.equal(style.background, "rgba(21, 21, 28, .5)");
  assert.equal(style.color, "#1234");
  assert.equal(style.borderColor, "transparent");
});
