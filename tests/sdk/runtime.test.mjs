import test from "node:test";
import assert from "node:assert/strict";
import {
  createPvoRuntime,
  evaluateWhen,
  resolveTextTemplate,
  resolveTemplates,
  validatePvo,
} from "../../packages/pvo-sdk/index.js";
import { manifest } from "./manifest.fixture.mjs";

test("conditions and templates read state and response paths", () => {
  const context = {
    state: { score: 4, user: { name: "Ada" } },
    response: { ok: true, id: 9 },
  };
  assert.equal(evaluateWhen({ key: "score", gt: 3 }, context), true);
  assert.equal(evaluateWhen({ response: "/ok", is: true }, context), true);
  assert.equal(
    evaluateWhen(
      {
        all: [
          { key: "score", gte: 4 },
          { response: "/id", exists: true },
        ],
      },
      context,
    ),
    true,
  );
  assert.deepEqual(
    resolveTemplates(
      { title: "Hi {state.user.name}", id: "{response.id}" },
      context,
    ),
    { title: "Hi Ada", id: 9 },
  );
  assert.equal(
    resolveTextTemplate("Score: {state.score}", context),
    "Score: 4",
  );
  assert.equal(resolveTextTemplate("{state.user.name}", context), "Ada");
  assert.equal(resolveTextTemplate("{state.missing}", context), "");
  assert.equal(resolveTextTemplate("{state.user}", context), "");
});

test("runtime executes guarded state, navigation, visibility, and request outcomes", async () => {
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    show(component) {
      events.push(["show", component.id]);
    },
    hide(component) {
      events.push(["hide", component.id]);
    },
    gotoScene(scene) {
      events.push(["goto", scene]);
    },
    request(request) {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "https://creator.example/submit");
      return { ok: true, confirmation: "pvo_123" };
    },
  });

  await runtime.execute([
    { type: "set", key: "score", add: 2 },
    { type: "show", component: "tip", when: { key: "score", gt: 2 } },
    { type: "goto_scene", scene: "ending", when: { key: "path", is: "left" } },
    {
      type: "request",
      method: "POST",
      url: "https://creator.example/submit",
      body: { score: "{state.score}" },
      into: "server",
      on_success: [
        { type: "hide", component: "tip", when: { response: "/ok", is: true } },
      ],
    },
  ]);

  assert.equal(runtime.state.score, 3);
  assert.equal(runtime.state.server.confirmation, "pvo_123");
  assert.deepEqual(events, [
    ["show", "tip"],
    ["goto", "ending"],
    ["hide", "tip"],
  ]);
});

test("branch actions wait for matching recorded state", async () => {
  const delayed = manifest();
  delayed.scenes.push({ id: "decline", start: 10, end: 15 });
  const branch = {
    type: "branch",
    cases: [
      {
        when: { key: "answers.choice", is: true },
        then: [{ type: "goto_scene", scene: "ending" }],
      },
      {
        when: { key: "answers.choice", is: false },
        then: [{ type: "goto_scene", scene: "decline" }],
      },
    ],
  };
  delayed.triggers.push({
    id: "choice_branch",
    scene: "intro",
    at: 4,
    actions: [branch],
  });
  assert.equal(validatePvo(delayed).valid, true);

  const destinations = [];
  const runtime = createPvoRuntime(delayed, {
    gotoScene(scene) {
      destinations.push(scene);
    },
    custom(name) {
      assert.equal(name, "submit_form");
      return false;
    },
  });
  await runtime.execute(branch);
  assert.deepEqual(destinations, []);
  await runtime.execute([
    { type: "custom", name: "submit_form", into: "answers.choice" },
    branch,
  ]);
  assert.equal(runtime.state.answers.choice, false);
  assert.deepEqual(destinations, ["decline"]);
});

test("state paths cannot traverse inherited properties or mutate prototypes", () => {
  const runtime = createPvoRuntime(manifest());
  assert.equal(
    evaluateWhen(
      { key: "constructor", exists: true },
      { state: runtime.state },
    ),
    false,
  );
  assert.throws(
    () => runtime.setState("forms.__proto__.polluted", true),
    /reserved key/,
  );
  assert.equal({}.polluted, undefined);
});
