import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export { validateAssistantContext } from "./editor/src/domain/assistant/context.ts";
      export { localPreviewDraft } from "./editor/src/domain/assistant/localPreview.ts";
      export { assistantFailureNotification, AssistantServiceError } from "./editor/src/domain/assistant/failure.ts";
      export { supportedAssistantRules, supportedAssistantStyle } from "./editor/src/domain/assistant/proposalPolicy.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
  define: { "import.meta.env": "{}" },
});
const { validateAssistantContext, localPreviewDraft, assistantFailureNotification, AssistantServiceError,
  supportedAssistantRules, supportedAssistantStyle } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const source = {
  structure: '<choice><prompt>Which?</prompt><option id="a">One</option><option id="b">Two</option></choice>',
  style: "choice { background: #15151C; }\nprompt { font-size: 20px; }",
  logic: "on choose(a) { continue(); } on choose(b) { continue(); }",
};
const request = prompt => ({ componentType: "choice", source: { ...source }, prompt });
const structure = { type: "choice", prompt: "Which?", options: [{ id: "a", label: "One" }, { id: "b", label: "Two" }] };

test("the isolated phrase fixture preserves content/actions and reports unmapped parts", () => {
  for (const prompt of ["Softer colours", "Bolder", "make the heading larger"]) {
    const proposal = localPreviewDraft(request(prompt), structure);
    assert.equal(proposal.source.structure, source.structure);
    assert.equal(proposal.source.logic, source.logic);
    assert.ok(proposal.source.style.length > source.style.length);
  }
  const partial = localPreviewDraft(request("Make it softer and send an email"), structure);
  assert.deepEqual(partial.skipped, ["Skipped: send an email."]);
  assert.equal(partial.source.logic, source.logic);
  assert.throws(() => localPreviewDraft(request("send an email"), structure), /Local preview supports/);
});

test("local phrases combine approved colours, sizes and corners while preserving unknown requests", () => {
  const proposal = localPreviewDraft(request("make it blue and larger heading and rounded corners and add a shadow"), structure);
  assert.match(proposal.source.style, /choice \{ background: #60A5FA; \}/);
  assert.match(proposal.source.style, /prompt \{ font-size: 25px; \}/);
  assert.match(proposal.source.style, /choice \{ border-radius: 24px; \}/);
  assert.equal(proposal.source.logic, source.logic);
  assert.deepEqual(proposal.skipped, ["Skipped: add a shadow."]);
  assert.throws(() => localPreviewDraft(request("heading 100px"), structure), /Local preview supports/);
});

test("wording keeps quoted conjunctions and escapes markup while adding at most two Card buttons", () => {
  const card = { type: "card", title: "Hello", body: "Body", buttons: [] };
  const input = { componentType: "card", source: {
    structure: "<card><title>Hello</title><body>Body</body></card>", style: "", logic: "",
  }, prompt: 'set heading to "Salt and pepper, <hello>" and add a button "Continue" and jump to 0:07' };
  const proposal = localPreviewDraft(input, card);
  assert.match(proposal.source.structure, /<title>Salt and pepper, &lt;hello&gt;<\/title>/);
  assert.match(proposal.source.structure, /<button id="button0">Continue<\/button>/);
  assert.match(proposal.source.logic, /on press\(button0\) \{ jump_to\(7\); \}/);
  assert.deepEqual(proposal.skipped, []);
  assert.equal(card.buttons.length, 0, "The current compiled structure is never mutated");
  const capped = localPreviewDraft({ ...input, prompt: 'add a button "One"; add a button "Two"; add a button "Three"' }, card);
  assert.equal((capped.source.structure.match(/<button /g) ?? []).length, 2);
  assert.deepEqual(capped.skipped, ['Skipped: add a button "Three".']);
});

test("local route requests target approved events and preserve the other option", () => {
  const rules = ["a", "b"].map(target => ({ event: "choose", target, action: { kind: "continue" } }));
  const proposal = localPreviewDraft(request('second option go to scene "branch"'), structure, rules);
  assert.match(proposal.source.logic, /on choose\(a\) \{ continue\(\); \}/);
  assert.match(proposal.source.logic, /on choose\(b\) \{ go_to_scene\("branch"\); \}/);
  assert.throws(() => localPreviewDraft(request("open https://example.com"), structure, rules), /Local preview supports/);
});

test("unsupported properties are dropped before compilation and malformed values still reach the compiler", () => {
  const result = supportedAssistantStyle({ ...source, style: "choice { background: #fff; box-shadow: 0 0 4px red; }" });
  assert.equal(result.source.style, "choice { background: #fff; }");
  assert.deepEqual(result.skipped, ["“box-shadow” isn't a supported style."]);
  const unsafe = { ...source, style: "choice { background: url(https://example.com); }" };
  assert.deepEqual(supportedAssistantStyle(unsafe).source, unsafe, "The Rust compiler owns supported-property value validation");
});

test("assistant action policy preserves existing requests but cannot introduce or change network effects", () => {
  const action = { kind: "request", url: "https://example.com", method: "GET", body: "",
    onSuccess: { kind: "continue" }, onError: null };
  const original = [{ event: "choose", target: "a", action }];
  const same = supportedAssistantRules(original, structuredClone(original));
  assert.deepEqual(same.rules, original);
  assert.deepEqual(same.skipped, []);
  const altered = { ...original[0], action: { ...action, url: "https://other.example.com" } };
  const result = supportedAssistantRules(original, [altered, { ...altered, target: "b" }]);
  assert.deepEqual(result.rules, original);
  assert.equal(result.skipped.length, 2);
  const approved = { ...original[0], action: { kind: "time", t: 3 } };
  assert.deepEqual(supportedAssistantRules(original, [approved]).rules, [approved]);
});

test("isolated size fixture respects inherited tooltip size and the PVO upper limit", () => {
  const tooltip = { type: "tooltip", text: "Tip" };
  const input = { componentType: "tooltip", source: { structure: "<tooltip><text>Tip</text></tooltip>", style: "tooltip { font-size: 40px; }", logic: "" }, prompt: "Larger text" };
  const proposal = localPreviewDraft(input, tooltip);
  assert.match(proposal.source.style, /text \{ font-size: 50px; \}/);
  input.source.style = "text { font-size: 72px; }";
  assert.throws(() => localPreviewDraft(input, tooltip), /already at the PVO limit/);
});

test("larger controls use each current ID size and respect the compiler's source-order cascade", () => {
  const input = request("larger button");
  input.source.style = "option { font-size: 12px; } #a { font-size: 16px; } #b { font-size: 20px; }";
  const proposal = localPreviewDraft(input, structure);
  assert.match(proposal.source.style, /#a \{ font-size: 20px; \}/);
  assert.match(proposal.source.style, /#b \{ font-size: 25px; \}/);
  input.source.style += " option { font-size: 24px; }";
  const laterGeneric = localPreviewDraft(input, structure);
  assert.match(laterGeneric.source.style, /#a \{ font-size: 30px; \}/);
  assert.match(laterGeneric.source.style, /#b \{ font-size: 30px; \}/);
});

test("project route validation checks direct and request success/error destinations", () => {
  const context = { sceneIds: ["main", "branch"], duration: 8 };
  const check = action => validateAssistantContext({ rules: [{ event: "choose", target: "a", action }] }, context);
  assert.doesNotThrow(() => check({ kind: "time", t: 8 }));
  assert.doesNotThrow(() => check({ kind: "scene", sceneId: "branch" }));
  assert.throws(() => check({ kind: "time", t: 9 }), /outside/);
  assert.throws(() => check({ kind: "scene", sceneId: "empty" }), /empty or missing/);
  const action = { kind: "request", url: "https://example.com", method: "GET", body: "", onSuccess: { kind: "continue" }, onError: { kind: "time", t: 99 } };
  assert.throws(() => check(action), /outside/);
  assert.throws(() => check({ ...action, onError: null, onSuccess: { kind: "scene", sceneId: "missing" } }), /empty or missing/);
});

test("assistant request proposals preserve fixed hosts and the supplied project destination limits", () => {
  const action = { kind: "request", url: "https://API.Example.com/path/{state.id}", method: "POST",
    body: '{"value":"{state.value}"}', onSuccess: { kind: "continue" }, onError: null };
  const context = { sceneIds: ["main"], duration: 8, requestDomains: ["api.example.com"] };
  const check = (value = action, policy = context) => validateAssistantContext({
    rules: [{ event: "choose", target: "option0", action: value }],
  }, policy);
  assert.doesNotThrow(() => check());
  assert.doesNotThrow(() => check(action, { sceneIds: ["main"], duration: 8 }), "The host restriction is optional for existing callers");
  assert.throws(() => check(action, { ...context, requestDomains: [] }), /Add this request destination in the component editor first/);
  assert.throws(() => check({ ...action, url: "https://api.example.com:8080/path" }), /destination/);
  assert.throws(() => check({ ...action, url: "https://other.example.com" }), /destination/);
  assert.throws(() => check({ ...action, url: "javascript:alert(1)" }), /HTTP/);
  assert.throws(() => check({ ...action, url: "https://{state.host}/path" }), /fixed host/);
  assert.throws(() => check({ ...action, url: "https://user:secret@api.example.com" }), /fixed host/);
  assert.throws(() => check({ ...action, body: "not JSON" }), /valid JSON/);
});


test("native service failures map to one curated notification", () => {
  for (const [status, notification] of Object.entries({
    400: "assistantInvalidRequest", 413: "assistantTooLarge", 422: "assistantUnsupported",
    429: "assistantBusy", 503: "assistantUnavailable", 504: "assistantTimeout", 500: "assistantFailed",
  })) assert.equal(assistantFailureNotification(new AssistantServiceError(Number(status))), notification);
});
