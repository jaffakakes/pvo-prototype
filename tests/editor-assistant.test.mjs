import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export { createAssistantService } from "./editor/src/infrastructure/assistant/service.ts";
      export { validateAssistantRequest, validateAssistantDraft } from "./editor/src/domain/assistant/validation.ts";
      export { validateAssistantContext } from "./editor/src/domain/assistant/context.ts";
      export { localPreviewDraft } from "./editor/src/domain/assistant/localPreview.ts";
      export { createHttpProvider } from "./editor/src/infrastructure/assistant/httpProvider.ts";
      export { assistantFailureNotification } from "./editor/src/domain/assistant/failure.ts";
      export { assistantRequestContext } from "./editor/src/domain/assistant/requestContext.ts";
      export { supportedAssistantRules, supportedAssistantStyle } from "./editor/src/domain/assistant/proposalPolicy.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
  define: { "import.meta.env": "{}" },
});
const { createAssistantService, validateAssistantRequest, validateAssistantDraft, validateAssistantContext,
  localPreviewDraft, createHttpProvider, assistantFailureNotification, assistantRequestContext,
  supportedAssistantRules, supportedAssistantStyle } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const source = {
  structure: '<choice><prompt>Which?</prompt><option id="a">One</option><option id="b">Two</option></choice>',
  style: "choice { background: #15151C; }\nprompt { font-size: 20px; }",
  logic: "on choose(a) { continue(); } on choose(b) { continue(); }",
};
const formattedSource = {
  structure: '<choice>\n  <prompt>Which?</prompt>\n  <option id="a">One</option>\n  <option id="b">Two</option>\n</choice>',
  style: "choice {\n  background: #15151C;\n}\n\nprompt {\n  font-size: 20px;\n}",
  logic: "on choose(a) {\n  continue();\n}\n\non choose(b) {\n  continue();\n}",
};
const request = prompt => ({ componentType: "choice", source: { ...source }, prompt });
const structure = { type: "choice", prompt: "Which?", options: [{ id: "a", label: "One" }, { id: "b", label: "Two" }] };
const compiled = { structure, rules: [], html: "internal renderer output", css: "", js: "" };
const draft = overrides => ({
  source: { ...source }, summary: "A PVO proposal", tags: ["PVO Style"],
  followUps: ["Softer colours", "Larger heading", "Bolder"], ...overrides,
});

test("the default service validates returned source before making it readable", async () => {
  const sent = [];
  const calls = [];
  const service = createAssistantService({
    fetch: async (url, options) => { sent.push({ url, options }); return Response.json(draft()); },
    compile: async (kind, value) => { calls.push({ kind, value }); return compiled; },
  });
  assert.equal(service.mode, "connected");
  assert.equal(service.label, "PVO assistant");
  const input = request("Larger heading");
  const proposal = await service.propose(input);
  assert.equal(proposal.mode, "connected");
  assert.deepEqual(proposal.source, formattedSource);
  assert.deepEqual(input.source, source, "A proposal cannot mutate the current editor source");
  assert.deepEqual(calls.map(call => call.kind), ["choice", "choice", "choice"]);
  assert.deepEqual(calls[1].value, source, "The unmodified provider response is validated first");
  assert.deepEqual(calls[2].value, formattedSource, "Formatting gets a separate compiler equivalence check");
  assert.deepEqual(Object.keys(proposal.compiled).sort(), ["rules", "structure"]);
  assert.equal(proposal.followUps.length, 3);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "http://localhost/api/assistant");
  assert.deepEqual(JSON.parse(sent[0].options.body), input);
});

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

test("connected requests use only the configured endpoint and return compiler-checked PVO", async () => {
  let sent;
  let checked;
  const service = createAssistantService({ endpoint: "https://assistant.example/propose",
    fetch: async (url, options) => { sent = { url, options }; return Response.json(draft()); },
    compile: async (kind, value) => { checked = { kind, value }; return compiled; },
  });
  const signal = new AbortController().signal;
  const proposal = await service.propose(request("Make a variation"), { signal });
  assert.equal(proposal.mode, "connected");
  assert.equal(sent.url, "https://assistant.example/propose");
  assert.equal(sent.options.signal.aborted, false);
  assert.equal(sent.options.credentials, "omit");
  assert.equal(sent.options.redirect, "error");
  assert.deepEqual(JSON.parse(sent.options.body), request("Make a variation"));
  assert.deepEqual(checked, { kind: "choice", value: formattedSource });
});

test("provider HTTP failures stay live failures with curated local notifications and no fallback", async () => {
  const expected = { 400: "assistantInvalidRequest", 413: "assistantTooLarge", 422: "assistantUnsupported",
    429: "assistantBusy", 503: "assistantUnavailable", 504: "assistantTimeout", 500: "assistantFailed" };
  for (const [status, notification] of Object.entries(expected)) {
    let calls = 0;
    const service = createAssistantService({ endpoint: "", compile: async () => compiled,
      fetch: async () => { calls++; return new Response("Untrusted raw provider detail", { status: Number(status) }); },
    });
    await assert.rejects(service.propose(request("Softer colours")), error => {
      assert.equal(error.status, Number(status));
      assert.equal(assistantFailureNotification(error), notification);
      assert.doesNotMatch(error.message, /Untrusted/);
      return true;
    });
    assert.equal(calls, 1, "Failures must not retry secretly or invoke the phrase fixture");
  }
});

test("default requests include bounded current playable scene context without media", async () => {
  const scenes = Array.from({ length: 105 }, (_, n) => ({ id: `scene-${n}`, name: `Scene ${n}`, clips: [{}] }));
  scenes.push({ id: "empty", name: "Empty", clips: [] });
  const context = assistantRequestContext("scene-104", 8, scenes);
  assert.equal(context.scenes.length, 100);
  assert.deepEqual(context.scenes[0], { id: "scene-104", name: "Scene 104" });
  assert(!context.scenes.some(scene => scene.id === "empty"));
  assert.equal(assistantRequestContext("empty", 8, scenes), undefined);
  assert.equal(assistantRequestContext("scene-0", NaN, scenes), undefined);
  const input = { ...request("Bolder"), context };
  const service = createAssistantService({ compile: async () => compiled, fetch: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json(draft());
  } });
  await service.propose(input);
});

test("connected proposals never salvage altered requests or unsupported source into review", async () => {
  const action = { kind: "request", url: "https://example.com", method: "GET", body: "",
    onSuccess: { kind: "continue" }, onError: null };
  const original = { ...compiled, rules: [{ event: "choose", target: "a", action }] };
  let count = 0;
  const service = createAssistantService({ fetch: async () => Response.json(draft()),
    compile: async () => ++count === 1 ? original : compiled });
  await assert.rejects(service.propose(request("Remove that action")), error => {
    assert.equal(error.code, "advanced_required");
    assert.equal(assistantFailureNotification(error), "assistantAdvancedRequired");
    return true;
  });
  count = 0;
  await assert.rejects(service.propose({ ...request("Remove that action"), editingMode: "advanced" }), /must remain unchanged/);
  const invalid = { ...source, style: "choice { box-shadow: 0 0 4px red; }" };
  const strict = createAssistantService({ fetch: async () => Response.json(draft({ source: invalid })),
    compile: async (_type, value) => {
      if (value.style.includes("box-shadow")) throw new Error("Unsupported Style property");
      return compiled;
    } });
  await assert.rejects(strict.propose(request("Add a shadow")), /Unsupported Style property/);
});

test("connected requests bound both fetch and response decoding, aborting on timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const bodyPending of [false, true]) {
    let transportSignal;
    const provider = createHttpProvider("https://assistant.example", async (_url, options) => {
      transportSignal = options.signal;
      if (!bodyPending) return new Promise(() => {});
      return { ok: true, json: () => new Promise(() => {}) };
    }, 30);
    const pending = provider(request("Bolder"));
    await Promise.resolve();
    t.mock.timers.tick(30);
    await assert.rejects(pending, /timed out/);
    assert.equal(transportSignal.aborted, true);
  }
});

test("connected cancellation settles even when the transport ignores its abort signal", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  let transportSignal;
  const provider = createHttpProvider("https://assistant.example", async (_url, options) => {
    transportSignal = options.signal;
    return new Promise(() => {});
  }, 30);
  const pending = provider(request("Bolder"), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(transportSignal.aborted, true);
  t.mock.timers.tick(100);
});

test("compiler failures and Restyle's two-option limit cannot become preview proposals", async () => {
  const fetch = async () => Response.json(draft());
  const service = createAssistantService({ endpoint: "https://assistant.example", fetch,
    compile: async () => { throw new Error("Rejected PVO Style"); },
  });
  await assert.rejects(service.propose(request("Bolder")), /Rejected PVO Style/);
  const tooMany = createAssistantService({ endpoint: "https://assistant.example", fetch,
    compile: async () => ({ ...compiled, structure: { ...structure, options: [...structure.options, { id: "c", label: "Three" }] } }),
  });
  await assert.rejects(tooMany.propose(request("More options")), /exactly two/);
});

test("source envelopes reject legacy code, missing sections, malformed metadata, and oversized input", () => {
  assert.throws(() => validateAssistantRequest(request("x".repeat(2001))), /2000/);
  assert.throws(() => validateAssistantRequest({ ...request("Bolder"), source: { ...source, html: "<script>bad()</script>" } }), /unsupported fields/);
  assert.throws(() => validateAssistantDraft(draft({ source: { structure: source.structure, style: "" } })), /logic/);
  assert.throws(() => validateAssistantDraft(draft({ source: { ...source, style: "x".repeat(128 * 1024 + 1) } })), /at most/);
  assert.throws(() => validateAssistantDraft(draft({ followUps: ["Only one"] })), /exactly three/);
  assert.throws(() => validateAssistantDraft(draft({ tags: [42] })), /Proposal tag/);
  assert.throws(() => createAssistantService({ endpoint: "javascript:alert(1)" }), /HTTP/);
});

test("aborting before a request or during compilation prevents any returned proposal", async () => {
  const controller = new AbortController();
  controller.abort();
  const service = createAssistantService({ compile: async () => { throw new Error("Must not compile"); } });
  await assert.rejects(service.propose(request("Bolder"), { signal: controller.signal }), { name: "AbortError" });
  const during = new AbortController();
  const connected = createAssistantService({ endpoint: "https://assistant.example",
    fetch: async () => Response.json(draft()),
    compile: async () => { during.abort(); return compiled; },
  });
  await assert.rejects(connected.propose(request("Bolder"), { signal: during.signal }), { name: "AbortError" });
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
