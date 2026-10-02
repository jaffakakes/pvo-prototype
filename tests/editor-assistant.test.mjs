import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export { validateAssistantContext } from "./editor/src/domain/assistant/context.ts";
      export { assistantFailureNotification, AssistantServiceError } from "./editor/src/domain/assistant/failure.ts";
      export { supportedAssistantRules, supportedAssistantStyle } from "./editor/src/domain/assistant/proposalPolicy.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
  define: { "import.meta.env": "{}" },
});
const { validateAssistantContext, assistantFailureNotification, AssistantServiceError,
  supportedAssistantRules, supportedAssistantStyle } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const source = {
  structure: '<choice><prompt>Which?</prompt><option id="a">One</option><option id="b">Two</option></choice>',
  style: "choice { background: #15151C; }\nprompt { font-size: 20px; }",
  logic: "on choose(a) { continue(); } on choose(b) { continue(); }",
};

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
