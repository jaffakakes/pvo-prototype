import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validatePvo } from "../../packages/pvo-sdk/index.js";
import { manifest } from "./manifest.fixture.mjs";

test("validatePvo accepts a coherent manifest", () => {
  const result = validatePvo(manifest());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validatePvo checks Card button actions without treating button wrappers as actions", () => {
  const project = manifest();
  project.components.push({
    id: "card",
    kind: "card",
    title: "Next step",
    presentation: {
      scene: "intro",
      start: 1,
      end: 4,
      x: 0.2,
      y: 0.2,
      width: 0.5,
      height: 0.3,
    },
    response_policy: { dispatch: "interaction", unanswered: "continue" },
    actions: [
      { label: "Continue", action: { type: "goto_scene", scene: "ending" } },
    ],
  });
  assert.deepEqual(validatePvo(project).errors, []);

  project.components.at(-1).actions[0].action.scene = "missing";
  assert.match(validatePvo(project).errors.join("\n"), /missing scene/);
});

test("response policies accept every dispatch and unanswered combination", () => {
  for (const dispatch of ["interaction", "layer_end"])
    for (const unanswered of ["continue", "pause"]) {
      const project = manifest();
      project.components[1].presentation = {
        scene: "intro",
        start: 1,
        end: 4,
        x: 0.2,
        y: 0.2,
        width: 0.5,
        height: 0.3,
      };
      project.components[1].response_policy = { dispatch, unanswered };
      assert.deepEqual(
        validatePvo(project).errors,
        [],
        `${dispatch}/${unanswered}`,
      );
    }
});

test("response policies are required for interactive timed components and forbidden on tooltips", () => {
  const invalid = manifest();
  invalid.components[0].response_policy = {
    dispatch: "later",
    unanswered: "wait",
  };
  const errors = validatePvo(invalid).errors.join("\n");
  assert.match(errors, /dispatch must be "interaction" or "layer_end"/);
  assert.match(errors, /unanswered must be "continue" or "pause"/);
  assert.match(errors, /only available for card, choice, or form/);

  const extra = manifest();
  extra.components[1].presentation = {
    scene: "intro",
    start: 1,
    end: 4,
    x: 0.2,
    y: 0.2,
    width: 0.5,
    height: 0.3,
  };
  extra.components[1].response_policy = {
    dispatch: "interaction",
    unanswered: "continue",
    wait: true,
  };
  assert.match(
    validatePvo(extra).errors.join("\n"),
    /unsupported fields: wait/,
  );

  const missing = manifest();
  delete missing.components[1].response_policy;
  assert.match(
    validatePvo(missing).errors.join("\n"),
    /response_policy is required/,
  );
});

test("validatePvo rejects the removed scene_change component field", () => {
  const project = manifest();
  project.components[1].scene_change = { scene: "ending" };
  assert.match(
    validatePvo(project).errors.join("\n"),
    /scene_change is not supported; use an explicit goto_scene or seek action/,
  );
});

test("validatePvo rejects removed binary branch timeline metadata", () => {
  const project = manifest();
  project.media = [{ id: "video", asset_id: "video" }];
  project.playback = {
    initial_timeline: "main",
    timelines: [
      {
        id: "main",
        kind: "main",
        source_component: "choice",
        condition: "true",
        clips: [
          { id: "clip", asset_id: "video", scene: "intro", start: 0, end: 5 },
        ],
      },
    ],
  };
  const errors = validatePvo(project).errors.join("\n");
  assert.match(errors, /source_component is not supported/);
  assert.match(errors, /condition is not supported/);
});

test("validatePvo rejects removed pause and direct Card-action shapes", () => {
  const removed = manifest();
  removed.components[0].pause = true;
  assert.match(
    validatePvo(removed).errors.join("\n"),
    /pause is not supported/,
  );

  const direct = manifest();
  direct.components.push({
    id: "card",
    kind: "card",
    title: "Go",
    presentation: {
      scene: "intro",
      start: 1,
      end: 4,
      x: 0.2,
      y: 0.2,
      width: 0.5,
      height: 0.3,
    },
    response_policy: { dispatch: "interaction", unanswered: "continue" },
    actions: [{ type: "seek", time: 2 }],
  });
  assert.match(
    validatePvo(direct).errors.join("\n"),
    /must be a Card button with an action or actions/,
  );
});

test("validatePvo requires the complete interactive presentation contract", () => {
  const project = manifest();
  project.components[1].presentation = {
    scene: "missing",
    start: 4,
    end: 2,
    x: -1,
    y: 0,
    width: 2,
  };
  const errors = validatePvo(project).errors.join("\n");
  assert.match(errors, /presentation\.scene references a missing scene/);
  assert.match(errors, /presentation\.end must be greater than start/);
  assert.match(errors, /presentation\.x must be between 0 and 1/);
  assert.match(errors, /presentation\.width must be between 0 and 1/);
  assert.match(errors, /presentation\.height must be between 0 and 1/);

  delete project.components[1].presentation;
  assert.match(
    validatePvo(project).errors.join("\n"),
    /presentation is required/,
  );
});

test("a buttonless Card cannot pause for a response nobody can provide", () => {
  const project = manifest();
  project.components.push({
    id: "announcement",
    kind: "card",
    title: "Read this",
    actions: [],
    presentation: {
      scene: "intro",
      start: 1,
      end: 4,
      x: 0.2,
      y: 0.2,
      width: 0.5,
      height: 0.3,
    },
    response_policy: { dispatch: "layer_end", unanswered: "pause" },
  });
  assert.match(
    validatePvo(project).errors.join("\n"),
    /cannot pause for a response without at least one Card button/,
  );
});

test("validatePvo reports broken references and coordinates", () => {
  const broken = manifest();
  broken.initial_scene = "missing";
  broken.hotspots[0].x = 0.9;
  broken.hotspots[0].width = 0.5;
  broken.hotspots[0].actions = [{ type: "show", component: "missing" }];
  const result = validatePvo(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("initial_scene")));
  assert.ok(result.errors.some((error) => error.includes("right edge")));
  assert.ok(result.errors.some((error) => error.includes("missing component")));
});

test("published schema declares the required response policy", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../packages/pvo-sdk/pvo-manifest.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(
    schema.properties.components.items.properties.response_policy.required,
    ["dispatch", "unanswered"],
  );
});
