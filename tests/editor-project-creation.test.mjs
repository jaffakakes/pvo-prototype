import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const compiled = buildSync({
  stdin: { contents: 'export * from "./editor/src/domain/project/creation.ts"; export * from "./editor/src/domain/project/templates.ts"; export * from "./editor/src/domain/components/languageCompilation.ts";', resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { projectName, nameFromFile, mediaIssue, MAX_VIDEO_BYTES, templateProject, PROJECT_TEMPLATES, componentLanguageSource } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

test("project creation accepts an empty name and derives readable names from media", () => {
  assert.equal(projectName("  "), "Untitled edit");
  assert.equal(nameFromFile("summer_holiday-final.mov"), "summer holiday final");
  assert.equal(projectName("x".repeat(200)).length, 120);
});

test("media validation permits video and rejects unsupported or oversized files", () => {
  assert.equal(mediaIssue({ name: "clip.MOV", type: "", size: 1024 }), null);
  assert.equal(mediaIssue({ name: "clip.webm", type: "video/webm", size: MAX_VIDEO_BYTES }), null);
  assert.match(mediaIssue({ name: "large.mp4", type: "video/mp4", size: MAX_VIDEO_BYTES + 1 }), /larger than 2 GB/);
  assert.match(mediaIssue({ name: "notes.txt", type: "text/plain", size: 10 }), /supported video/);
});

test("templates create independent scenes with varied editable PVO examples", () => {
  let id = 0;
  const media = { id: 1, url: "blob:sample", color: "#fff", srcDur: 7.9, in: 0, out: 7.9, speed: 1, zoom: 1, mirror: false, width: 720, height: 1280, fit: "contain" };
  const types = { caption: "tooltip", card: "card", choice: "choice", route: "card", jump: "card", form: "form" };
  const scripts = [];
  for (const template of PROJECT_TEMPLATES) {
    const project = templateProject(template, media, () => ++id);
    assert.equal(project.scenes.length, template.scenes);
    assert.equal(project.ratio, template.ratio);
    assert.equal(project.currentSceneId, "main");
    assert.equal(new Set(project.scenes.flatMap(scene => scene.clips.map(clip => clip.id))).size, template.scenes);
    assert.equal(project.scenes[0].components.length, 1);
    const sample = project.scenes[0].components[0];
    assert.equal(sample.type, types[template.hint]);
    if (sample.type === "tooltip") assert.equal(sample.responsePolicy, undefined);
    else assert.deepEqual(sample.responsePolicy, { dispatch: "interaction", unanswered: "continue" });
    for (const outcome of [
      ...(sample.fields.buttons ?? []).map(button => button.outcome),
      ...(sample.fields.options ?? []).map(option => option.outcome),
    ]) if (outcome?.kind === "scene") assert.ok(project.scenes.some(scene => scene.id === outcome.sceneId));
    const source = componentLanguageSource(sample);
    scripts.push(`${source.structure}\n${source.style}\n${source.logic}`);
    if (sample.type === "tooltip") assert.equal(source.logic, "");
    else assert.match(source.logic, /^on (press|choose|submit)/);
    if (template.hint === "jump") {
      const jump = sample.fields.buttons.find(button => button.outcome.kind === "time")?.outcome;
      assert.equal(jump?.kind, "time");
      assert.ok(jump.t > 0, "The timeline sample should jump to a real highlight, not replay from zero");
    }
    project.scenes[0].clips[0].out = 1;
    assert.equal(media.out, 7.9);
    if (project.scenes[1]) assert.equal(project.scenes[1].clips[0].out, 6);
  }
  assert.equal(new Set(scripts).size, PROJECT_TEMPLATES.length);
});

test("launch templates keep the gallery's ratios, metadata, colours and hint kinds", () => {
  assert.deepEqual(PROJECT_TEMPLATES.map(({ id, title, ratio, scenes, duration, interactive, behaviour, posterColor, hint }) =>
    ({ id, title, ratio, scenes, duration, interactive, behaviour, posterColor, hint })), [
    { id: "talking-head", title: "Talking head", ratio: "9:16", scenes: 2, duration: 30, interactive: false, behaviour: undefined, posterColor: "#4A2A3E", hint: "caption" },
    { id: "product-drop", title: "Product drop", ratio: "9:16", scenes: 3, duration: undefined, interactive: true, behaviour: "Message actions", posterColor: "#1F3D33", hint: "card" },
    { id: "choose-your-path", title: "Choose your path", ratio: "9:16", scenes: 3, duration: undefined, interactive: true, behaviour: "Choice branching", posterColor: "#2B2347", hint: "choice" },
    { id: "travel-recap", title: "Travel recap", ratio: "9:16", scenes: 5, duration: undefined, interactive: true, behaviour: "Scene routing", posterColor: "#4A3B23", hint: "route" },
    { id: "podcast-clip", title: "Podcast clip", ratio: "1:1", scenes: 1, duration: undefined, interactive: true, behaviour: "Timeline jump", posterColor: "#23404A", hint: "jump" },
    { id: "tutorial", title: "Tutorial", ratio: "16:9", scenes: 3, duration: undefined, interactive: true, behaviour: "Local form", posterColor: "#3A2A1F", hint: "form" },
  ]);
});
