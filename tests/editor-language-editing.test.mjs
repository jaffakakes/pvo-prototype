import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export { editComponentFields } from "./editor/src/domain/components/languageEditing.ts";
      export { fieldsShownFor, fieldsFromCompiled } from "./editor/src/domain/components/fields.ts";
      export { resolveLanguageSource } from "./editor/src/domain/components/languageCompilation.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { editComponentFields, fieldsShownFor, fieldsFromCompiled, resolveLanguageSource } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const continuing = { kind: "continue" };

test("editing another field keeps in-progress whitespace without rewriting Structure for an outcome", () => {
  const component = card();
  component.code.pvoTouched = false;
  component.fields.title = "A title ";
  component.code.pvo.structure = component.code.pvo.structure.replace("A title</title>", "A title </title>");
  const labelEdit = editComponentFields(component, { ...component.fields, body: "Another body" });
  assert.match(labelEdit.code.pvo.structure, /<title>A title <\/title>/);
  const outcomeEdit = editComponentFields(component, {
    ...component.fields,
    buttons: component.fields.buttons.map((button, index) => index === 0 ? { ...button, outcome: continuing } : button),
  });
  assert.equal(outcomeEdit.code.pvo.structure, component.code.pvo.structure);
});

function authored(structure, rules, source) {
  const compiled = { structure, rules };
  return {
    id: "component", type: structure.type, sceneId: "main", at: 0, dur: 3, x: 50, y: 50,
    fields: fieldsFromCompiled(compiled),
    code: { custom: true, pvoLiteral: true, pvo: source, pvoCompiled: compiled },
  };
}

function card() {
  return authored({
    type: "card", title: "A title", body: "A body", buttons: [
      { id: "learn", label: "Learn more" }, { id: "next", label: "Continue" },
    ],
  }, [
    { event: "press", target: "next", action: continuing },
    { event: "press", target: "learn", action: { kind: "time", t: 4 } },
  ], {
    structure: "<card>\n<title>A title</title>\n<body>A body</body>\n<button id='learn'>Learn more</button>\n<button id='next'>Continue</button>\n</card>",
    style: "card { background: #123; }\n#learn { color: #fff; }\n#next  { color: #abc; }",
    logic: "on press(next) {continue();}\non press(learn) {jump_to(4);}",
  });
}

function form() {
  return authored({
    type: "form", fields: [
      { name: "given", kind: "name" }, { name: "family", kind: "name" }, { name: "contact", kind: "email" },
    ], submit: "Send",
  }, [{ event: "submit", target: null, action: continuing }], {
    structure: '<form>\n<field name="given" kind="name" />\n<field name="family" kind="name" />\n<field name="contact" kind="email" />\n<submit>Send</submit>\n</form>',
    style: "form { color: #fff; }\n#given { background: #123; }\n#contact { color: #abc; }",
    logic: "on submit { continue(); }",
  });
}

test("Fields-only editing keeps source absent and preserves unrelated field data", () => {
  const component = { ...card(), code: undefined, fields: { title: "Before", body: "Retained", buttons: [] } };
  const edited = editComponentFields(component, { ...component.fields, title: "After" });
  assert.equal(edited.code, undefined);
  assert.deepEqual(edited.fields, { title: "After", body: "Retained", buttons: [] });
  assert.equal(component.fields.title, "Before");
});

test("changing a label keeps authored IDs, styles, and differently ordered Logic byte-for-byte", () => {
  const component = card();
  const original = structuredClone(component);
  const edited = editComponentFields(component, {
    ...component.fields, title: 'A & <new> "title"',
    buttons: component.fields.buttons.map((button, index) => index === 0 ? { ...button, label: "Explore" } : button),
  });
  assert.match(edited.code.pvo.structure, /<title>A &amp; &lt;new&gt; &quot;title&quot;<\/title>/);
  assert.match(edited.code.pvo.structure, /<button id="learn">Explore<\/button>/);
  assert.equal(edited.code.pvo.style, component.code.pvo.style);
  assert.equal(edited.code.pvo.logic, component.code.pvo.logic);
  assert.equal(edited.code.pvoCompiled.structure.buttons[0].label, "Explore");
  assert.deepEqual(edited.code.pvoCompiled.rules.find(rule => rule.target === "learn").action, { kind: "time", t: 4 });
  assert.equal(edited.code.custom, true);
  assert.equal(edited.code.pvoTouched, false);
  assert.deepEqual(component, original);
});

test("an outcome edit keeps Structure and Style byte-for-byte and uses its authored control ID", () => {
  const component = card();
  const request = {
    kind: "request", url: "https://example.com/save", method: "POST", body: '{"message":"Curly } and ( text"}',
    onSuccess: { kind: "scene", sceneId: "done" }, onError: { kind: "time", t: 2 },
  };
  const edited = editComponentFields(component, {
    ...component.fields,
    buttons: component.fields.buttons.map((button, index) => index === 1 ? { ...button, outcome: request } : button),
  });
  assert.equal(edited.code.pvo.structure, component.code.pvo.structure);
  assert.equal(edited.code.pvo.style, component.code.pvo.style);
  assert.match(edited.code.pvo.logic, /on press\(next\)/);
  assert.match(edited.code.pvo.logic, /request\(/);
  assert.deepEqual(edited.code.pvoCompiled.rules.find(rule => rule.target === "next").action, request);
  assert.deepEqual(edited.code.pvoCompiled.rules.find(rule => rule.target === "learn").action, { kind: "time", t: 4 });
});

test("removing the first of identical buttons retains the second identity and only removes the deleted ID style", () => {
  const component = card();
  component.fields.buttons = [{ label: "Same", outcome: continuing }, { label: "Same", outcome: continuing }];
  component.code.pvoCompiled.structure.buttons = [{ id: "learn", label: "Same" }, { id: "next", label: "Same" }];
  component.code.pvoCompiled.rules = [
    { event: "press", target: "learn", action: continuing }, { event: "press", target: "next", action: continuing },
  ];
  const edited = editComponentFields(component, { ...component.fields, buttons: [fieldsShownFor(component).buttons[1]] });
  assert.deepEqual(edited.code.pvoCompiled.structure.buttons, [{ id: "next", label: "Same" }]);
  assert.doesNotMatch(edited.code.pvo.structure, /id="learn"/);
  assert.doesNotMatch(edited.code.pvo.logic, /press\(learn\)/);
  assert.equal(edited.code.pvo.style, "card { background: #123; }\n\n#next  { color: #abc; }");
});

test("adding a button chooses a fresh ID without renaming the existing control", () => {
  const component = card();
  const removed = editComponentFields(component, { ...component.fields, buttons: [component.fields.buttons[1]] });
  const current = { ...component, ...removed };
  const edited = editComponentFields(current, {
    ...current.fields, buttons: [...current.fields.buttons, { label: "Added", outcome: { kind: "scene", sceneId: "other" } }],
  });
  assert.deepEqual(edited.code.pvoCompiled.structure.buttons, [{ id: "next", label: "Continue" }, { id: "button0", label: "Added" }]);
  assert.match(edited.code.pvo.logic, /on press\(button0\) \{\n  go_to_scene\("other"\);/);
  assert.equal(edited.code.pvo.style, current.code.pvo.style);
});

test("editing a form label preserves duplicate kinds, names, ordering, and submit action", () => {
  const component = form();
  const edited = editComponentFields(component, { ...component.fields, submitLabel: "Send details" });
  assert.deepEqual(edited.code.pvoCompiled.structure.fields, component.code.pvoCompiled.structure.fields);
  assert.match(edited.code.pvo.structure, /name="given" kind="name"/);
  assert.match(edited.code.pvo.structure, /name="family" kind="name"/);
  assert.match(edited.code.pvo.structure, /<submit>Send details<\/submit>/);
  assert.equal(edited.code.pvo.logic, component.code.pvo.logic);
  assert.equal(edited.code.pvo.style, component.code.pvo.style);
});

test("toggling form kinds preserves retained names and removes only styles for removed fields", () => {
  const component = form();
  const edited = editComponentFields(component, { ...component.fields, fieldKinds: ["email", "phone"] });
  assert.deepEqual(edited.code.pvoCompiled.structure.fields, [
    { name: "contact", kind: "email" }, { name: "phone_0", kind: "phone" },
  ]);
  assert.equal(edited.code.pvo.style, "form { color: #fff; }\n\n#contact { color: #abc; }");
  assert.equal(edited.code.pvo.logic, component.code.pvo.logic);
});

test("legacy custom tokens are resolved against old fields before outcome synchronization", () => {
  const component = card();
  component.code.pvoLiteral = undefined;
  component.code.pvo.structure = '<card><title>{{title}}</title><button id="learn">{{buttons[0].label}}</button><button id="next">{{buttons[1].label}}</button></card>';
  const edited = editComponentFields(component, {
    ...component.fields,
    buttons: component.fields.buttons.map((button, index) => index === 0 ? { ...button, outcome: continuing } : button),
  });
  assert.match(edited.code.pvo.structure, /<title>A title<\/title>/);
  assert.doesNotMatch(edited.code.pvo.structure, /\{\{/);
  assert.equal(edited.code.pvoLiteral, true);
});

test("literal token-shaped text stays literal after no-code edits", () => {
  const component = card();
  const edited = editComponentFields(component, { ...component.fields, title: "Keep {{title}} as text" });
  assert.match(edited.code.pvo.structure, /<title>Keep \{\{title\}\} as text<\/title>/);
  const current = { ...component, ...edited };
  assert.equal(resolveLanguageSource(current, edited.code.pvo).structure, edited.code.pvo.structure);
});

test("an unchanged custom edit retains all source sections and omitted card children", () => {
  const component = authored({ type: "card", title: null, body: "Only a body", buttons: [] }, [], {
    structure: "<card><body>Only a body</body></card>", style: "body { color: #abc; }", logic: " \n",
  });
  const unchanged = editComponentFields(component, component.fields);
  assert.deepEqual(unchanged.code.pvo, component.code.pvo);
  const edited = editComponentFields(component, { ...component.fields, body: "Updated body" });
  assert.doesNotMatch(edited.code.pvo.structure, /<title>/);
  assert.equal(edited.code.pvoCompiled.structure.title, null);
});

test("starter source remains synchronized without claiming Advanced ownership", () => {
  const component = card();
  component.code.custom = false;
  const edited = editComponentFields(component, { ...component.fields, title: "New title" });
  assert.equal(edited.code.custom, false);
  assert.equal(edited.code.pvoLiteral, true);
  assert.equal(edited.code.pvoCompiled.structure.title, "New title");
  assert.match(edited.code.pvo.structure, /<title>New title<\/title>/);
  assert.match(resolveLanguageSource({ ...component, ...edited }, edited.code.pvo).structure, /<title>New title<\/title>/);
});

test("pending or invalid Advanced drafts cannot be overwritten through another Fields entry point", () => {
  const component = card();
  component.code.pvoTouched = true;
  component.code.pvo.structure = "<card><title>Unfinished";
  const edited = editComponentFields(component, { ...component.fields, title: "Fields overwrite" });
  assert.equal(edited.fields, component.fields);
  assert.equal(edited.code, component.code);
  assert.equal(edited.code.pvo.structure, "<card><title>Unfinished");
});

test("a Choice label edit keeps the other choice, IDs, and outcomes", () => {
  const component = authored({ type: "choice", prompt: "Pick", options: [
    { id: "first", label: "A" }, { id: "second", label: "B" },
  ] }, [
    { event: "choose", target: "first", action: { kind: "scene", sceneId: "a" } },
    { event: "choose", target: "second", action: continuing },
  ], {
    structure: '<choice><prompt>Pick</prompt><option id="first">A</option><option id="second">B</option></choice>',
    style: "#first { color: #f00; }", logic: 'on choose(first) {go_to_scene("a");}\non choose(second) {continue();}',
  });
  const edited = editComponentFields(component, { ...component.fields,
    options: component.fields.options.map((option, index) => index === 1 ? { ...option, label: "Second" } : option),
  });
  assert.deepEqual(edited.code.pvoCompiled.structure.options, [{ id: "first", label: "A" }, { id: "second", label: "Second" }]);
  assert.equal(edited.code.pvo.logic, component.code.pvo.logic);
  assert.equal(edited.code.pvo.style, component.code.pvo.style);
});

function phoneForm() {
  return authored({ type: "form", heading: "What is your number?", submit: "Send", fields: [
    { name: "contact_phone", kind: "phone", label: "Phone number" },
    { name: "contact_email", kind: "email", label: "Email" },
  ] }, [{ event: "submit", target: null, action: continuing }], {
    structure: '<form><heading>What is your number?</heading><field name="contact_phone" kind="phone" label="Phone number"/><field name="contact_email" kind="email" label="Email"/><submit>Send</submit></form>',
    style: "form { background: #123; }\n#contact_phone { color: #fff; }\n#contact_email { color: #abc; }",
    logic: "on submit { continue(); }",
  });
}

test("visual form labels, removal and new types retain authored phone and email identity", () => {
  const original = phoneForm();
  const renamed = { ...original, ...editComponentFields(original, { ...original.fields,
    heading: "Contact me", formFields: original.fields.formFields.map((field, at) => at === 0 ? { ...field, name: "Mobile number" } : field),
  }) };
  assert.deepEqual(renamed.code.pvoCompiled.structure.fields[0], { name: "contact_phone", kind: "phone", label: "Mobile number" });
  assert.equal(renamed.code.pvo.style, original.code.pvo.style);
  assert.equal(renamed.code.pvo.logic, original.code.pvo.logic);
  const removed = { ...renamed, ...editComponentFields(renamed, { ...renamed.fields, formFields: [renamed.fields.formFields[0]] }) };
  assert.match(removed.code.pvo.style, /#contact_phone/);
  assert.doesNotMatch(removed.code.pvo.style, /#contact_email/);
  const added = editComponentFields(removed, { ...removed.fields, formFields: [...removed.fields.formFields, { name: "Age", type: "number" }] });
  assert.deepEqual(added.code.pvoCompiled.structure.fields, [
    { name: "contact_phone", kind: "phone", label: "Mobile number" },
    { name: "field_0", kind: "number", label: "Age" },
  ]);
});

test("visual destination setup binds generated answers to authored names, then follows row changes", () => {
  const original = phoneForm();
  const connected = { ...original, ...editComponentFields(original, { ...original.fields, formSubmitMode: "request", destination: "https://example.com/answers" }) };
  const request = connected.code.pvoCompiled.rules[0].action;
  assert.equal(request.kind, "request");
  assert.deepEqual(JSON.parse(request.body).answers.map(answer => answer.value), [
    "{state.form.component.contact_phone}", "{state.form.component.contact_email}",
  ]);
  const edited = editComponentFields(connected, { ...connected.fields,
    formFields: [{ ...connected.fields.formFields[0], name: "Your phone" }, connected.fields.formFields[1]],
  });
  assert.equal(JSON.parse(edited.code.pvoCompiled.rules[0].action.body).answers[0].name, "Your phone");
  const authoredRequest = { ...request, body: '{"phone":"{state.form.component.contact_phone}","custom":true}' };
  connected.fields.outcome = authoredRequest;
  connected.code.pvoCompiled.rules[0].action = authoredRequest;
  connected.code.pvo.logic = `on submit { request(${JSON.stringify(authoredRequest)}); }`;
  const customEdit = editComponentFields(connected, { ...connected.fields, heading: "Different heading" });
  assert.equal(customEdit.code.pvoCompiled.rules[0].action.body, authoredRequest.body);
  assert.equal(customEdit.code.pvo.logic, connected.code.pvo.logic);
  assert.throws(() => editComponentFields(connected, { ...connected.fields, formFields: [connected.fields.formFields[1]] }), /used by the submit action/);
  const cleared = { ...connected, ...editComponentFields(connected, { ...connected.fields, destination: "" }) };
  assert.deepEqual(cleared.code.pvoCompiled.rules[0].action, continuing);
  assert.doesNotMatch(cleared.code.pvo.logic, /request\(/);
  assert.equal(cleared.fields.destination, "");
  const removedAfterClear = editComponentFields(cleared, { ...cleared.fields, formFields: [cleared.fields.formFields[1]] });
  assert.equal(removedAfterClear.code.pvoCompiled.structure.fields[0].name, "contact_email");
});
