import test from "node:test";
import assert from "node:assert/strict";
import { packPvoProject, readPvoProject, validatePvo } from "../packages/pvo-sdk/index.js";

test("Restyle field-based components remain valid in a self-contained scene package", async () => {
  const continueAction = { type: "custom", name: "restyle_continue" };
  const manifest = {
    spec_version: "0.1-prototype",
    initial_scene: "main",
    canvas: { ratio: "9:16", width: 9, height: 16 },
    restyle_capture: { version: 1 },
    media: [
      { id: "media-main", asset_id: "asset-main", name: "media/main.webm", type: "video/webm" },
      { id: "media-b", asset_id: "asset-b", name: "media/b.webm", type: "video/webm" },
    ],
    scenes: [
      { id: "main", label: "Main", asset_id: "asset-main", start: 0, end: 5 },
      { id: "b", label: "Scene B", asset_id: "asset-b", start: 0, end: 3 },
    ],
    playback: {
      initial_timeline: "timeline-main",
      timelines: [
        { id: "timeline-main", kind: "main", clips: [{ id: "clip-main", scene: "main", asset_id: "asset-main", start: 0, end: 5 }] },
        { id: "timeline-b", kind: "branch", clips: [{ id: "clip-b", scene: "b", asset_id: "asset-b", start: 0, end: 3 }] },
      ],
    },
    components: [
      {
        id: "choice-1", kind: "choice", title: "Which look next?",
        response_policy: { dispatch: "interaction", unanswered: "continue" },
        presentation: { scene: "main", start: 2, end: 5, x: .5, y: .62, width: .71, height: .4 },
        options: [
          { label: "Streetwear", action: { type: "goto_scene", scene: "b" } },
          { label: "Skip ahead", action: { type: "seek", time: 4 } },
          { label: "Keep watching", action: continueAction },
        ],
        restyle_capture: { version: 1, at: 2, dur: null, outcomes: [
          { kind: "scene", sceneId: "b" }, { kind: "time", t: 4 }, { kind: "continue" },
        ] },
      },
      {
        id: "form-1", kind: "form",
        response_policy: { dispatch: "interaction", unanswered: "continue" },
        presentation: { scene: "b", start: 1, end: 3, x: .5, y: .62, width: .77, height: .38 },
        fields: [{ name: "name_0", label: "Name", type: "text" }], on_submit: continueAction,
        submit_label: "Send",
        restyle_capture: { version: 1, at: 1, dur: null, outcomes: [{ kind: "continue" }] },
      },
    ],
  };
  assert.deepEqual(validatePvo(manifest).errors, []);
  const packed = await packPvoProject({
    manifest,
    assets: [
      { id: "asset-main", name: "media/main.webm", blob: new Blob(["main"], { type: "video/webm" }) },
      { id: "asset-b", name: "media/b.webm", blob: new Blob(["branch"], { type: "video/webm" }) },
    ],
  });
  const decoded = await readPvoProject(packed);
  assert.equal(decoded.validation.valid, true);
  assert.equal(decoded.manifest.components[0].options.length, 3);
  assert.equal(decoded.manifest.components[0].restyle_capture.outcomes[0].sceneId, "b");
  assert.equal(decoded.assets.length, 2);
});
