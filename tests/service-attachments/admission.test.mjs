import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { initSync } from "../../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../../packages/pvo-language/index.js";
import { serviceAttachmentRequest } from "../../packages/pvo-assistant/attachments/index.js";
import { validateNativeResult } from "../../server/assistant/native/policy.js";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import { prepareServiceAttachmentReceipt } from "../../packages/pvo-assistant/attachments/index.js";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { create, now } from "../assistant-tasks/fixtures.mjs";
import { attachment } from "./fixtures.mjs";

initSync({
  module: new WebAssembly.Module(
    await readFile(
      new URL(
        "../../packages/pvo-language/pkg/pvo_language_bg.wasm",
        import.meta.url,
      ),
    ),
  ),
});
const bundled = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
  export * from './editor/src/domain/assistant/native/batch.ts';
  export { nativeProjectContext } from './editor/src/domain/assistant/native/context.ts';
`,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const task = create();
const publication = await prepareServicePublication(
  task,
  "host-one",
  await checkedFixture(),
  task.createdAt + 86_400_000,
);
const receipt = prepareServiceAttachmentReceipt(
  publication,
  { identity: publication.identity, state: "available" },
  "join",
  now,
);
const project = () => ({
  currentSceneId: "main",
  ratio: "9:16",
  allowedDomains: [],
  scenes: [
    {
      id: "main",
      name: "Main",
      parent: null,
      muted: false,
      sound: 0,
      texts: [],
      components: [],
      audioClips: [],
      clips: [
        { id: 1, url: "blob:private", srcDur: 10, in: 0, out: 10, speed: 1 },
      ],
    },
  ],
});
const actionSource = (action) => `request(${JSON.stringify(action)});`;
const requestAction = (authorization) => ({
  ...serviceAttachmentRequest(authorization),
  onSuccess: { kind: "continue" },
  onError: null,
});
function authorization() {
  const value = {
    command: attachment(publication.identity.resourceId),
    receipt: structuredClone(receipt),
    scope: {
      ownerId: task.ownerId,
      projectId: task.input.projectId,
      taskId: task.id,
    },
    now,
    origin: "https://restyle.example",
  };
  value.command.component.source = {
    structure:
      '<form><heading>Join dinner</heading><field name="guest" kind="name" label="Name"/><submit>Join</submit></form>',
    style: "",
    logic: `on submit { ${actionSource(requestAction(value))} }`,
  };
  return value;
}
const prepare = (
  before,
  value,
  authorization,
  advancedEditingEnabled = false,
) =>
  api.prepareNativeBatch(before, [value], {
    createId: () => 42,
    compile: compilePvoComponent,
    advancedEditingEnabled,
    ...(authorization ? { attachment: authorization } : {}),
  });
const server = (before, value, authorization) => {
  const context = api.nativeProjectContext(before, 0);
  // Boundary fixture supplies a known original. Production projection still hides private request bodies.
  for (const scene of context.scenes)
    for (const component of scene.components) {
      const actual = before.scenes
        .find((item) => item.id === scene.id)
        ?.components.find((item) => item.id === component.id);
      if (actual?.code?.pvo) component.source = actual.code.pvo;
    }
  return validateNativeResult(
    { mode: "edit", project: context },
    { message: "Connect the form.", observations: [], operations: [value] },
    compilePvoComponent,
    authorization,
  );
};
async function rejected(before, auth, expression) {
  await assert.rejects(
    server(before, auth.command.component, auth),
    expression,
  );
  await assert.rejects(
    prepare(before, auth.command.component, auth),
    expression,
  );
}

test("server and editor admit one separately verified connection with real compiler output and without a general request bypass", async () => {
  const before = project(),
    auth = authorization();
  await server(before, auth.command.component, auth);
  const batch = await prepare(before, auth.command.component, auth);
  assert.equal(before.scenes[0].components.length, 0);
  assert.equal(
    batch.project.scenes[0].components[0].code.pvoCompiled.rules[0].action.url,
    requestAction(auth).url,
  );
  assert.equal(batch.attachment.componentId, "component-42");
  api.validateNativeBatchEditingMode(batch, false);
  for (const advanced of [false, true])
    await assert.rejects(
      prepare(before, auth.command.component, undefined, advanced),
    );
  await assert.rejects(
    server(before, auth.command.component),
    /Configure new network/,
  );
  const changed = structuredClone(auth);
  changed.command.component.source.style = "form { color: red; }";
  await assert.rejects(
    prepare(before, auth.command.component, changed),
    /exactly one/,
  );
});

test("both boundaries reject mismatched identity, address, method, payload, field, event and invalid success routes", async () => {
  for (const change of [
    (auth) => {
      auth.scope.ownerId = "other";
    },
    (auth) => {
      auth.command.component.source.logic =
        auth.command.component.source.logic.replace(
          "https://restyle.example",
          "https://invented.example",
        );
    },
    (auth) => {
      auth.command.component.source.logic =
        auth.command.component.source.logic.replace('"POST"', '"GET"');
    },
    (auth) => {
      auth.command.component.source.logic = `on submit { ${actionSource({ ...requestAction(auth), body: JSON.stringify({ operation: "join", input: { name: "Alice" }, actionId: "invented" }) })} }`;
    },
    (auth) => {
      auth.command.component.source.structure =
        auth.command.component.source.structure.replace(
          'name="guest"',
          'name="missing"',
        );
    },
    (auth) => {
      auth.command.component.source.structure =
        auth.command.component.source.structure.replace(
          'kind="name"',
          'kind="number"',
        );
    },
    (auth) => {
      auth.command.connection.event = "press";
      auth.command.connection.target = "missing";
    },
    (auth) => {
      auth.command.component.source.logic = `on submit { ${actionSource({ ...requestAction(auth), onSuccess: { kind: "time", t: 11 } })} }`;
    },
  ]) {
    const auth = authorization();
    change(auth);
    await rejected(project(), auth);
  }
});

test("an authorized control preserves an unrelated existing request; a second new or modified request is rejected", async () => {
  const local = {
    kind: "component.add",
    sceneId: "main",
    componentType: "card",
    at: 0,
    duration: 5,
    source: {
      structure:
        '<card><title>Dinner</title><button id="join">Join</button><button id="info">Info</button></card>',
      style: "",
      logic: "on press(join) { continue(); } on press(info) { continue(); }",
    },
  };
  const before = (await prepare(project(), local)).project;
  const component = before.scenes[0].components[0];
  const other = {
    url: "https://existing.example/info",
    method: "GET",
    body: "",
    onSuccess: { kind: "continue" },
    onError: null,
  };
  const source = {
    ...local.source,
    logic: `on press(join) { continue(); } on press(info) { ${actionSource(other)} }`,
  };
  const compiled = await compilePvoComponent("card", source);
  component.code = {
    custom: true,
    pvoLiteral: true,
    pvo: source,
    pvoLastValid: source,
    pvoCompiled: { structure: compiled.structure, rules: compiled.rules },
  };
  const auth = authorization();
  auth.command.component = {
    kind: "component.source",
    sceneId: "main",
    componentId: component.id,
    source: { ...source },
  };
  auth.command.connection.event = "press";
  auth.command.connection.target = "join";
  auth.command.connection.input = { kind: "literal", value: { name: "Alice" } };
  auth.command.component.source.logic = `on press(join) { ${actionSource(requestAction(auth))} } on press(info) { ${actionSource(other)} }`;
  await assert.rejects(
    validateNativeResult(
      { mode: "edit", project: api.nativeProjectContext(before, 0) },
      {
        message: "Connect the card.",
        observations: [],
        operations: [auth.command.component],
      },
      compilePvoComponent,
      auth,
    ),
    /source is unavailable/,
  );
  await server(before, auth.command.component, auth);
  const batch = await prepare(before, auth.command.component, auth);
  api.validateNativeBatchEditingMode(batch, false);
  const changed = structuredClone(auth);
  changed.command.component.source.logic =
    changed.command.component.source.logic.replace(
      "existing.example",
      "changed.example",
    );
  await rejected(before, changed, /request/);
  const added = structuredClone(auth);
  added.command.component = { ...local, source: auth.command.component.source };
  await rejected(project(), added, /request/);
  const overwritten = structuredClone(auth);
  overwritten.command.connection.target = "info";
  overwritten.command.component.source.logic = `on press(join) { continue(); } on press(info) { ${actionSource(requestAction(overwritten))} }`;
  await rejected(before, overwritten, /replace an existing request/);
  batch.project.scenes[0].components[0].code.pvoCompiled.rules[1].action.url =
    "https://changed.example/info";
  assert.throws(
    () => api.validateNativeBatchEditingMode(batch, false),
    /request/,
  );
  assert.throws(
    () => api.validateNativeBatchEditingMode(batch, true),
    /request/,
  );
});

test("form mapping cannot smuggle state templates or use a non-form control's fields", async () => {
  const auth = authorization();
  auth.command.connection.input = {
    kind: "literal",
    value: { name: "{state.private}" },
  };
  auth.command.component.source.logic = `on submit { ${actionSource(requestAction(auth))} }`;
  await rejected(project(), auth, /state templates/);
  const card = authorization();
  card.command.component.componentType = "card";
  card.command.component.source.structure =
    '<card><title>Dinner</title><button id="join">Join</button></card>';
  card.command.connection.event = "press";
  card.command.connection.target = "join";
  card.command.component.source.logic = `on press(join) { ${actionSource(requestAction(card))} }`;
  await rejected(project(), card, /Only form/);
});
