import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const compiled = buildSync({
  stdin: { contents: 'export * from "./editor/src/domain/project/creation.ts"; export * from "./editor/src/domain/project/templates.ts";', resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { projectName, nameFromFile, mediaIssue, MAX_VIDEO_BYTES, templateProject, PROJECT_TEMPLATES } =
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

test("templates create independent editable scenes with valid choice destinations", () => {
  let id = 0;
  const media = { id: 1, url: "blob:sample", color: "#fff", srcDur: 7.9, in: 0, out: 7.9, speed: 1, zoom: 1, mirror: false, width: 720, height: 1280, fit: "contain" };
  for (const template of PROJECT_TEMPLATES) {
    const project = templateProject(template, media, () => ++id);
    assert.equal(project.scenes.length, template.scenes);
    assert.equal(project.ratio, template.ratio);
    assert.equal(project.currentSceneId, "main");
    assert.equal(new Set(project.scenes.flatMap(scene => scene.clips.map(clip => clip.id))).size, template.scenes);
    const choice = project.scenes[0].components[0];
    if (template.interactive) {
      assert.equal(choice.fields.options.length, 2);
      for (const option of choice.fields.options) assert.ok(project.scenes.some(scene => scene.id === option.outcome.sceneId));
    } else assert.equal(choice, undefined);
    project.scenes[0].clips[0].out = 1;
    assert.equal(media.out, 7.9);
    if (project.scenes[1]) assert.equal(project.scenes[1].clips[0].out, 6);
  }
});
