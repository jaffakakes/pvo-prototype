import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createPvoRuntime, packPvoProject, readPvoProject, validatePvo } from "../packages/pvo-sdk/index.js";
import { createPlaybackSession } from "../player/playback/session.js";
import { createComponentActions } from "../player/actions/components.js";
import { formValuesForComponent } from "../player/actions/form-values.js";

const bundled = buildSync({
  stdin: {
    contents: `export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
      export * from "./editor/src/domain/components/forms.ts";
      export { fieldsFromCompiled } from "./editor/src/domain/components/fields.ts";
      export { editComponentFields } from "./editor/src/domain/components/languageEditing.ts";
      export { componentLanguageSource } from "./editor/src/domain/components/languageCompilation.ts";
      export { buildPvoManifest } from "./editor/src/domain/export/manifest.ts";
      export { captureCheckpoint, storeCheckpoint, restoreCheckpoint } from "./editor/src/infrastructure/projectPersistence/checkpoint.ts";
      export { getTryRuntime, startTry, stopTry, runFormSubmission } from "./editor/src/features/preview/tryMode.ts";
      export { useTryFeedback } from "./editor/src/features/preview/tryFeedbackStore.ts";
      export { beginPlayheadPick, acceptPlayheadPick } from "./editor/src/features/timeline/playheadPick.ts";
      export { clearDeletedComponentRoutes, deletionImpact } from "./editor/src/domain/scenes/references.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, initial, formFieldControls, setFormDestination, toVisualFormFields, validateFormFields, formUsesRequest,
  formValuesForSubmission, formSubmissionOutcome, buildPvoManifest, captureCheckpoint, storeCheckpoint,
  restoreCheckpoint, getTryRuntime, startTry, stopTry, runFormSubmission, useTryFeedback,
  beginPlayheadPick, acceptPlayheadPick, clearDeletedComponentRoutes, deletionImpact,
  fieldsFromCompiled, componentLanguageSource, editComponentFields } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function start() {
  const state = initial();
  state.scenes[0].clips = [mkClip(8, null, 0)];
  state.clips = state.scenes[0].clips;
  state.screen = "editor";
  useCapture.setState(state);
  useCapture.getState().addComponent("form");
  return useCapture.getState().components[0];
}
function update(fields) {
  const component = useCapture.getState().components[0];
  useCapture.getState().updateComponent(component.id, { fields: { ...component.fields, ...fields } });
  return useCapture.getState().components[0];
}
function manifest(languages) {
  const state = useCapture.getState();
  return buildPvoManifest(state, [{ scene: state.scenes[0], assetId: "video", name: "main.webm", type: "video/webm" }], languages);
}

test("named form controls keep safe identities and legacy email/phone behavior", () => {
  assert.deepEqual(formFieldControls({ formFields: [{ name: "Your age?", type: "number" }] }), [
    { name: "field_1", label: "Your age?", type: "number", inputType: "number" },
  ]);
  assert.deepEqual(formFieldControls({ fieldKinds: ["email", "phone"] }).map(({ name, inputType }) => [name, inputType]), [
    ["email_0", "email"], ["phone_1", "tel"],
  ]);
  assert.throws(() => validateFormFields([]), /one and five/);
  assert.throws(() => validateFormFields([{ name: "", type: "text" }]), /name/);
  assert.throws(() => setFormDestination({}, "javascript:alert(1)"), /HTTP/);
  assert.throws(() => setFormDestination({}, "https://user:pass@example.com"), /fixed host/);
  assert.equal(setFormDestination({}, " https://example.com/send ").destination, "https://example.com/send");
});

test("visual form editing projects an explicit request and both response routes", () => {
  const fields = {
    fieldKinds: ["name", "email"], submitLabel: "Join", outcome: {
      kind: "request", url: "https://example.com/join", method: "POST", body: "{}",
      onSuccess: { kind: "time", t: 5 }, onError: { kind: "time", t: 1 },
    },
  };
  assert.equal(formSubmissionOutcome({ id: "explicit", fields }), fields.outcome, "The authored request remains exact");
  const migrated = toVisualFormFields(fields);
  assert.equal(migrated.formSubmitMode, "request");
  assert.equal(migrated.destination, fields.outcome.url);
  assert.deepEqual(migrated.successOutcome, fields.outcome.onSuccess);
  assert.deepEqual(migrated.failureOutcome, fields.outcome.onError);
  assert.deepEqual(migrated.formFields, [{ name: "Name", type: "text" }, { name: "Email", type: "text" }]);
  const local = toVisualFormFields({ fieldKinds: ["name"], outcome: { kind: "time", t: 2 } });
  assert.equal(local.formSubmitMode, "local");
  assert.deepEqual(formSubmissionOutcome({ id: "local", fields: local }), { kind: "time", t: 2 });
  assert.equal(formUsesRequest({ formFields: [] }), false, "Form fields do not imply a request");
  assert.equal(formUsesRequest({ formFields: [], destination: fields.outcome.url }), false, "A destination does not imply a request");
  assert.equal(formUsesRequest({ outcome: fields.outcome }), true, "An authored request is explicit");
  assert.equal(formUsesRequest({ formSubmitMode: "local", outcome: fields.outcome }), false, "Explicit local replaces an authored request");
});

test("modern form source and compiled projection retain heading, labels, numeric input, waiting and request routes", () => {
  const form = start();
  const component = update({ heading: "Reserve & join", formFields: [{ name: "Seats {{text}}", type: "number" }],
    waitingLabel: "Reserving {{time}}…", formSubmitMode: "request", destination: "https://example.com/reserve", successOutcome: { kind: "time", t: 4 } });
  const source = componentLanguageSource(component);
  assert.match(source.structure, /<heading>Reserve &amp; join<\/heading>/);
  assert.match(source.structure, /kind="number" label="Seats \{\{text\}\}"/);
  assert.match(source.structure, /waiting="Reserving \{\{time\}\}…"/);
  const outcome = formSubmissionOutcome(component);
  const compiled = { structure: { type: "form", heading: component.fields.heading,
    fields: [{ name: "field_1", kind: "number", label: "Seats {{text}}" }],
    submit: "Send", waiting: component.fields.waitingLabel }, rules: [{ event: "submit", target: null, action: outcome }] };
  const projected = fieldsFromCompiled(compiled);
  assert.equal(projected.formSubmitMode, "request");
  assert.deepEqual(projected.formFields, component.fields.formFields);
  assert.equal(projected.heading, component.fields.heading);
  assert.equal(projected.waitingLabel, component.fields.waitingLabel);
  assert.equal(projected.destination, component.fields.destination);
  assert.deepEqual(projected.successOutcome, component.fields.successOutcome);
  const authored = { ...form, fields: projected, code: { custom: true, pvoLiteral: true, pvoTouched: false,
    pvo: source, pvoCompiled: compiled } };
  const edited = editComponentFields(authored, { ...projected, waitingLabel: "Almost there…", failureOutcome: { kind: "time", t: 1 } });
  assert.match(edited.code.pvo.structure, /waiting="Almost there…"/);
  assert.equal(edited.code.pvoCompiled.rules[0].action.body, outcome.body);
  assert.deepEqual(edited.code.pvoCompiled.rules[0].action.onError, { kind: "time", t: 1 });
  assert.equal(edited.code.pvoCompiled.structure.fields[0].name, "field_1");
  useCapture.getState().updateComponent(component.id, { fields: projected, code: authored.code });
  assert.equal(useCapture.getState().updateOutcome(component.id, { kind: "form" }, { ...outcome, onSuccess: { kind: "time", t: 7 } }), true);
  const changed = useCapture.getState().components[0];
  assert.deepEqual(changed.fields.successOutcome, { kind: "time", t: 7 });
  assert.deepEqual(changed.code.pvoCompiled.rules[0].action.onSuccess, { kind: "time", t: 7 });
});

test("explicit request methods and custom payloads survive projected destination and response edits", () => {
  for (const method of ["GET", "POST"]) {
    start();
    const request = {
      kind: "request", method, url: "https://example.com/check", body: '{"subscription":"annual","campaign":17}',
      onSuccess: { kind: "time", t: 6 }, onError: { kind: "time", t: 1 },
    };
    const migrated = toVisualFormFields({ fieldKinds: ["name"], submitLabel: "Check", outcome: request });
    assert.deepEqual(formSubmissionOutcome({ id: "explicit", fields: migrated }), request);
    const component = update({ ...setFormDestination(migrated, "https://example.com/revised"),
      successOutcome: { kind: "time", t: 7 }, failureOutcome: null });
    const expected = { ...request, url: "https://example.com/revised", onSuccess: { kind: "time", t: 7 }, onError: null };
    assert.deepEqual(formSubmissionOutcome(component), expected);
    const source = componentLanguageSource(component);
    assert.match(source.logic, new RegExp(`"method":"${method}"`));
    assert.ok(source.logic.includes(JSON.stringify(request.body)));
    const exported = manifest().components[0].on_submit;
    assert.equal(exported.method, method);
    assert.equal(exported.url, expected.url);
    assert.equal(exported.on_success.time, 7);
    assert.equal(exported.on_error, undefined);
    assert.deepEqual(exported.body, method === "POST" ? JSON.parse(request.body) : undefined);
  }
});

test("Advanced destination edits keep source-authored runtime field names and request payload references", () => {
  const request = { kind: "request", url: "https://example.com/original", method: "POST",
    body: '{"email":"{state.form.legacy.email_0}"}', onSuccess: { kind: "continue" }, onError: null };
  const fields = { fieldKinds: ["email"], submitLabel: "Send", outcome: request };
  const edited = { ...setFormDestination(fields, "https://example.com/revised"), successOutcome: { kind: "time", t: 2 } };
  const component = { id: "legacy", type: "form", fields: edited };
  assert.equal(edited.formFields, undefined);
  assert.deepEqual(formFieldControls(edited).map(field => field.name), ["email_0"]);
  assert.deepEqual(formSubmissionOutcome(component), { ...request, url: "https://example.com/revised", onSuccess: { kind: "time", t: 2 } });
  const source = componentLanguageSource(component);
  assert.match(source.structure, /name="email_0"/);
  assert.ok(source.logic.includes("https://example.com/revised"));
  assert.ok(source.logic.includes(JSON.stringify(request.body)));
  const initialLocal = { fieldKinds: ["email"], submitLabel: "Continue", outcome: { kind: "continue" } };
  const connected = setFormDestination(initialLocal, "https://example.com/answers");
  const generated = formSubmissionOutcome({ id: "legacy", fields: connected });
  assert.equal(generated.kind, "request");
  assert.ok(generated.body.includes("{state.form.legacy.email_0}"));
});

test("replacing a custom PVO request with a local action preserves field IDs and appearance", () => {
  start();
  const component = update({ formSubmitMode: "request", formFields: [{ name: "Phone", type: "text" }],
    destination: "https://example.com/answers", successOutcome: { kind: "time", t: 6 } });
  const request = { ...formSubmissionOutcome(component), body: '{"phone":"{state.form.contact.contact_phone}"}' };
  const source = {
    structure: '<form><heading>Contact me</heading><field name="contact_phone" kind="phone" label="Phone"/><submit>Send</submit></form>',
    style: 'form { background: #123456; } #contact_phone { color: #abcdef; }',
    logic: `on submit { request(${JSON.stringify(request)}); }`,
  };
  const compiled = { structure: { type: "form", heading: "Contact me", submit: "Send",
    fields: [{ name: "contact_phone", kind: "phone", label: "Phone" }] },
    rules: [{ event: "submit", target: null, action: request }] };
  const authored = { ...component, id: "contact", fields: fieldsFromCompiled(compiled),
    code: { custom: true, pvoLiteral: true, pvoTouched: false, pvo: source, pvoCompiled: compiled } };
  const changed = editComponentFields(authored, { ...authored.fields, formSubmitMode: "local", outcome: { kind: "time", t: 3 } });
  assert.equal(changed.code.pvo.structure, source.structure);
  assert.equal(changed.code.pvo.style, source.style);
  assert.match(changed.code.pvo.logic, /jump_to\(3\)/);
  assert.doesNotMatch(changed.code.pvo.logic, /request\(/);
  assert.equal(changed.fields.destination, "https://example.com/answers", "A retained destination cannot enable a local request");
  assert.deepEqual(formSubmissionOutcome({ ...authored, ...changed }), { kind: "time", t: 3 });
  assert.equal(fieldsFromCompiled(changed.code.pvoCompiled).formSubmitMode, "local");
});

test("modern form defaults, duplicate, history and checkpoint preserve independent field and outcome objects", () => {
  const original = start();
  assert.equal(original.fields.heading, "Get early access");
  assert.equal(original.fields.formSubmitMode, "local");
  assert.equal(original.fields.submitLabel, "Continue");
  assert.equal(original.look.preset, "bold");
  assert.equal(original.y, 60);
  update({ formFields: [{ name: "Age", type: "number" }], failureOutcome: { kind: "time", t: 2 } });
  const copyId = useCapture.getState().duplicateComponent(original.id);
  const [source, copy] = useCapture.getState().components;
  assert.equal(copy.id, copyId);
  assert.notEqual(copy.fields.formFields[0], source.fields.formFields[0]);
  assert.notEqual(copy.fields.failureOutcome, source.fields.failureOutcome);
  copy.fields.formFields[0].name = "Changed copy";
  assert.equal(source.fields.formFields[0].name, "Age");
  useCapture.getState().undo();
  assert.equal(useCapture.getState().components.length, 1);
  const checkpoint = storeCheckpoint(captureCheckpoint(useCapture.getState()), new Map(), 123);
  const restored = restoreCheckpoint(structuredClone(checkpoint), new Map());
  assert.deepEqual(restored.project.scenes[0].components[0].fields, useCapture.getState().components[0].fields);
});

test("form branch timeline picks and scene deletion affect the chosen response route", () => {
  start();
  const original = update({ submitLabel: "Send", formSubmitMode: "request" });
  beginPlayheadPick({ kind: "outcome-time", componentId: original.id, target: { kind: "form" }, branch: "error" });
  useCapture.getState().patch({ t: 4 });
  acceptPlayheadPick();
  assert.deepEqual(useCapture.getState().components[0].fields.failureOutcome, { kind: "time", t: 4 });
  const component = update({ successOutcome: { kind: "scene", sceneId: "branch" } });
  const scene = useCapture.getState().scenes[0];
  const branch = { ...scene, id: "branch", parent: "main", components: [] };
  assert.deepEqual(deletionImpact([scene, branch], "branch")[0].outcomes, ["Send · success"]);
  assert.deepEqual(clearDeletedComponentRoutes(component, new Set(["branch"])).fields.successOutcome, { kind: "continue" });
});

test("an overlay-only scene still allows a timeline timing pick", () => {
  const component = start();
  useCapture.getState().patch({ clips: [], t: 2.5, playheadPick: null });

  beginPlayheadPick({ kind: "component-at", componentId: component.id });

  assert.equal(useCapture.getState().playheadPick?.kind, "component-at");
  acceptPlayheadPick();
  assert.equal(useCapture.getState().components[0].at, 2.5);
  assert.equal(useCapture.getState().playheadPick, null);
});

test("interactive packages retain form heading, numeric fields, labels, destination and response branches", async () => {
  start();
  update({ heading: "Reserve yours", formFields: [{ name: "Number of seats", type: "number" }, { name: "Updates?", type: "yesno" }],
    formSubmitMode: "request", destination: "https://example.com/answers", waitingLabel: "Reserving…", successOutcome: { kind: "time", t: 5 } });
  const formId = useCapture.getState().components[0].id;
  const exported = manifest(new Map([[formId, { source: { structure: "", style: "", logic: "" }, compiled: {
    structure: { type: "form", fields: [{ name: "field_1", kind: "short" }], submit: "Code submit" },
    rules: [{ event: "submit", target: null, action: { kind: "continue" } }],
  } }]]));
  assert.deepEqual(validatePvo(exported).errors, []);
  assert.deepEqual(exported.allowed_domains, ["example.com"]);
  const component = exported.components[0];
  assert.equal(component.title, "Reserve yours");
  assert.equal(component.fields[0].label, "Number of seats");
  assert.equal(component.fields[0].type, "number");
  assert.equal(component.restyle_capture.form.waitingLabel, "Reserving…");
  assert.equal(component.restyle_capture.code, undefined, "Visual forms retain their native controls");
  assert.equal(component.on_submit.url, "https://example.com/answers");
  assert.equal(component.on_submit.on_success.time, 5);
  const packaged = await packPvoProject({ manifest: exported, assets: [
    { id: "video", name: "main.webm", blob: new Blob(["video"], { type: "video/webm" }) },
  ] });
  const decoded = await readPvoProject(packaged);
  assert.deepEqual(decoded.manifest.components[0].restyle_capture.form, component.restyle_capture.form);
});

test("Try waits for the real response, submits typed answers once and follows success only afterward", async t => {
  start();
  const component = update({ formFields: [{ name: "Seats", type: "number" }, { name: "Updates", type: "yesno" }],
    formSubmitMode: "request", destination: "https://example.com/answers", successOutcome: { kind: "time", t: 5 } });
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, options) => { requests.push({ url, options }); return response; });
  startTry();
  const submission = runFormSubmission(component, { field_1: "3", field_2: "yes" });
  assert.equal(useTryFeedback.getState().components[component.id].phase, "pending");
  assert.equal(useCapture.getState().t, 0);
  await runFormSubmission(component, { field_1: "9" });
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), { answers: [
    { name: "Seats", type: "number", value: 3 }, { name: "Updates", type: "yesno", value: true },
  ] });
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.redirect, "error");
  release(new Response("OK", { status: 200 }));
  await submission;
  assert.equal(useCapture.getState().t, 5);
  assert.equal(useTryFeedback.getState().components[component.id], undefined);
  stopTry();
});

test("Form fields and a destination do not imply a request without an explicit request action", async t => {
  start();
  const component = update({ formSubmitMode: undefined, destination: "https://example.com/answers" });
  let sends = 0;
  t.mock.method(globalThis, "fetch", async () => { sends++; return new Response("No", { status: 503 }); });
  assert.deepEqual(formSubmissionOutcome(component), { kind: "continue" });
  startTry();
  await runFormSubmission(component, { field_1: "Sam", field_2: "sam@example.com" });
  assert.equal(sends, 0);
  assert.deepEqual(getTryRuntime().state.form[component.id], { field_1: "Sam", field_2: "sam@example.com" });
  stopTry();
});

test("a configured failure route runs after a real rejected response and never runs success", async t => {
  start();
  const component = update({ formSubmitMode: "request", destination: "https://example.com/answers",
    successOutcome: { kind: "time", t: 6 }, failureOutcome: { kind: "time", t: 2 } });
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  t.mock.method(console, "warn", () => {});
  startTry();
  await runFormSubmission(component, { field_1: "Sam" });
  assert.equal(useCapture.getState().t, 2);
  assert.equal(useTryFeedback.getState().components[component.id], undefined);
  stopTry();
});

test("player validates native form messages, retains typed values, and clears pending after request failure", async () => {
  start();
  update({ formFields: [{ name: "Seats", type: "number" }], formSubmitMode: "request", destination: "https://example.com/answers" });
  const exported = manifest();
  const component = exported.components[0];
  assert.deepEqual(formValuesForComponent(component, { field_1: "4" }), { field_1: 4 });
  assert.throws(() => formValuesForComponent(component, { undeclared: "value" }), /not valid/);
  assert.throws(() => formValuesForComponent(component, { field_1: "NaN" }), /number/);
  assert.deepEqual(formValuesForSubmission(useCapture.getState().components[0].fields, { field_1: "2" }), { field_1: 2 });
  assert.equal(formSubmissionOutcome(useCapture.getState().components[0]).onError, null);
  const session = createPlaybackSession();
  session.manifest = exported;
  session.captureMode = true;
  session.actionRuntime = createPvoRuntime(exported, { request: async () => new Response("No", { status: 503 }) });
  const pending = [];
  const routes = [];
  const actions = createComponentActions({ session, adapters: {
    setComponentPending: (...args) => pending.push(args), setStatus() {},
    captureOutcome: () => ({ kind: "continue" }), applyActionOutcome: (...args) => routes.push(args),
  } });
  await actions.answerFieldComponent({ componentId: component.id, index: 0, fields: { field_1: "4" } });
  assert.deepEqual(pending, [[component.id, true], [component.id, false]]);
  assert.equal(routes.length, 0);
  assert.equal(session.pendingComponents.size, 0);
  assert.deepEqual(session.actionRuntime.state.form[component.id], { field_1: 4 });
});

test("local forms keep typed answers in Try and follow Continue, time and scene without requests", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Local forms must not send answers"); });
  for (const outcome of [{ kind: "continue" }, { kind: "time", t: 4 }, { kind: "scene", sceneId: "branch" }]) {
    start();
    const component = update({ formFields: [{ name: "Seats", type: "number" }, { name: "Updates", type: "yesno" }],
      outcome, destination: "https://unused.example/old-request" });
    const state = useCapture.getState();
    state.patch({ scenes: [...state.scenes, { ...state.scenes[0], id: "branch", parent: "main", name: "Branch", components: [] }] });
    assert.deepEqual(formSubmissionOutcome(component), outcome);
    const source = componentLanguageSource(component);
    assert.doesNotMatch(source.logic, /request\(/);
    if (outcome.kind === "time") assert.match(source.logic, /jump_to\(4\)/);
    if (outcome.kind === "scene") assert.match(source.logic, /go_to_scene\("branch"\)/);
    startTry();
    await runFormSubmission(component, { field_1: "3", field_2: "yes" });
    assert.deepEqual(getTryRuntime().state.form[component.id], { field_1: 3, field_2: true });
    assert.equal(useCapture.getState().currentSceneId, outcome.kind === "scene" ? "branch" : "main");
    assert.equal(useCapture.getState().t, outcome.kind === "time" ? 4 : 0);
    assert.equal(useCapture.getState().tryMode.playing, true);
    assert.deepEqual(useTryFeedback.getState().components, {});
    stopTry();
  }
  assert.equal(requests, 0);
});

test("native packages and player execute every local form route while retaining form state without a destination", async () => {
  for (const outcome of [{ kind: "continue" }, { kind: "time", t: 4 }, { kind: "scene", sceneId: "branch" }]) {
    start();
    update({ formFields: [{ name: "Seats", type: "number" }], outcome });
    const state = useCapture.getState();
    const scenes = [...state.scenes, { ...state.scenes[0], id: "branch", parent: "main", name: "Branch", components: [] }];
    const exported = buildPvoManifest({ ...state, scenes }, scenes.map(scene => ({
      scene, assetId: `video-${scene.id}`, name: `${scene.id}.webm`, type: "video/webm",
    })));
    assert.deepEqual(validatePvo(exported).errors, []);
    assert.deepEqual(exported.allowed_domains, []);
    const component = exported.components[0];
    assert.equal(component.restyle_capture.form.submitMode, "local");
    assert.equal(component.restyle_capture.form.destination, "");
    const session = createPlaybackSession();
    session.manifest = exported;
    session.captureMode = true;
    let requests = 0;
    session.actionRuntime = createPvoRuntime(exported, {
      request: async () => { requests++; throw new Error("Local forms must not send answers"); },
      custom: (_name, _payload, context) => { context.playerInteraction.outcome = { kind: "continue" }; },
      seek: (time, context) => { context.playerInteraction.outcome = { kind: "time", t: time }; },
      gotoScene: (sceneId, context) => { context.playerInteraction.outcome = { kind: "scene", sceneId }; },
    });
    const routes = [];
    const statuses = [];
    const actions = createComponentActions({ session, adapters: {
      setStatus: (...args) => statuses.push(args),
      captureOutcome: () => ({ kind: "continue" }),
      applyActionOutcome: (_component, _index, route) => routes.push(route),
    } });
    await actions.answerFieldComponent({ componentId: component.id, index: 0, fields: { field_1: "4" } });
    assert.deepEqual(routes, [outcome]);
    assert.deepEqual(statuses, []);
    assert.equal(requests, 0);
    assert.deepEqual(session.actionRuntime.state.form[component.id], { field_1: 4 });
    assert.equal(session.actionRuntime.state.answers, undefined);
  }
});
