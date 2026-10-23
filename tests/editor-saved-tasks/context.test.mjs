import assert from "node:assert/strict";
import test from "node:test";
import { api, project, proposal } from "./helpers.mjs";

test("cloud context keeps scene placement/timing while labelling redacted designs and excluding private media/request data", () => {
  const before = project();
  const source = {
    structure:
      '<card><title>Dinner</title><button id="join">Join</button></card>',
    style: "",
    logic:
      'on press(join) { request({"url":"https://private.example","method":"POST","body":"private-token","onSuccess":{"kind":"continue"},"onError":null}); }',
  };
  before.scenes[0].clips = [
    { id: 10, url: "blob:private-media", srcDur: 12, in: 0, out: 12, speed: 2 },
  ];
  before.scenes[0].components = [
    {
      id: "card",
      type: "card",
      responsePolicy: { dispatch: "interaction", unanswered: "continue" },
      at: 0,
      dur: 3,
      x: 50,
      y: 50,
      scale: 1,
      fields: { title: "Dinner", buttons: [{ label: "Join" }] },
      code: {
        custom: true,
        pvoLiteral: true,
        pvo: source,
        pvoLastValid: source,
        pvoCompiled: {
          structure: {
            type: "card",
            title: "Dinner",
            body: null,
            buttons: [{ id: "join", label: "Join" }],
          },
          rules: [
            {
              event: "press",
              target: "join",
              action: {
                kind: "request",
                url: "https://private.example",
                method: "POST",
                body: "private-token",
                onSuccess: { kind: "continue" },
                onError: null,
              },
            },
          ],
        },
      },
    },
  ];
  const create = () =>
    api.cloudTaskInput(before, "Add a service form", proposal, {
      projectId: "owned-project",
      operationId: "create",
      fingerprint: "saved-fingerprint",
    });
  const input = create();
  assert.equal(input.context.currentSceneId, before.currentSceneId);
  assert.deepEqual(input.context.scenes, [
    { id: "main", name: before.scenes[0].name, duration: 6 },
  ]);
  assert.equal(input.context.components[0].sourceVisibility, "design");
  assert.doesNotMatch(
    JSON.stringify(input),
    /private-token|private\.example|blob:private-media/,
  );
  assert.match(input.context.components[0].source.logic, /continue/);
  before.scenes[0].components[0].code.pvoCompiled.rules[0].action = {
    kind: "continue",
  };
  before.scenes[0].components[0].code.pvo.logic =
    "on press(join) { continue(); }";
  assert.equal(create().context.components[0].sourceVisibility, "full");
});
