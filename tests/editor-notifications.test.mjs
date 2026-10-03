import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export * from "./editor/src/domain/notifications/policy.ts";
      export { notificationCatalog } from "./editor/src/domain/notifications/catalog.ts";
      export { assistantFailureNotification, AssistantServiceError } from "./editor/src/domain/assistant/failure.ts";
      export * from "./editor/src/state/notifications/notificationStore.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { notificationCatalog, assistantFailureNotification, AssistantServiceError,
  initialNotifications, receiveNotification, dismissCurrentNotification,
  resolveNotificationEvent, removeNotificationScope, useNotifications, notify, resolveNotification,
  clearNotificationScope, dismissNotification, showNotificationIssue, resetNotifications } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("catalogue copy is bounded and only approved assistant Undo feedback uses success", () => {
  for (const [id, definition] of Object.entries(notificationCatalog)) {
    assert.ok(definition.message.length <= 50);
    if (id === "assistantApplied") assert.equal(definition.action, "undoAssistantEdit");
    else assert.notEqual(definition.kind, "success");
  }
  for (const id of ["saveFailed", "restoreFailed", "recordingFailed"])
    assert.equal(notificationCatalog[id].persistent, true);
});

test("brief events use a global ten-second cooldown and never queue dropped messages", () => {
  let state = receiveNotification(initialNotifications(), "voiceHoldShort", { scope: "assistant" }, 0);
  assert.equal(state.current.id, "voiceHoldShort");
  state = dismissCurrentNotification(state);
  const dropped = receiveNotification(state, "voiceDenied", { scope: "assistant", operation: "different", currentAttempt: true }, 9999);
  assert.equal(dropped, state);
  assert.equal(dropped.current, null);
  state = receiveNotification(state, "voiceDenied", { scope: "assistant", operation: "next", currentAttempt: true }, 10_000);
  assert.equal(state.current.id, "voiceDenied");
  assert.equal(state.unresolved.length, 0);
});

test("busy work suppresses unrelated messages but an actual failed attempt can notify", () => {
  const busy = { ...initialNotifications(), busy: true };
  assert.equal(receiveNotification(busy, "exportFailed", {}, 0), busy);
  const attempted = receiveNotification(busy, "assistantResponseInvalid", { currentAttempt: true }, 0);
  assert.equal(attempted.current.id, "assistantResponseInvalid");
  const risk = receiveNotification(busy, "recordingFailed", { scope: "recording:12" }, 0);
  assert.equal(risk.current.id, "recordingFailed");
});

test("a quick assistant retry shows its own failure after clearing the prior notification", () => {
  let state = receiveNotification(initialNotifications(), "assistantBusy", {
    scope: "assistant", operation: "request:1", currentAttempt: true,
  }, 0);
  state = removeNotificationScope(state, "assistant");
  assert.equal(state.current, null);
  assert.equal(state.lastBriefAt, 0, "Starting a retry retains the global hint cooldown");
  const retry = { scope: "assistant", operation: "request:2", currentAttempt: true };
  state = receiveNotification(state, assistantFailureNotification(new AssistantServiceError(429)), retry, 100);
  assert.equal(state.current.id, "assistantBusy");
  assert.equal(state.current.operation, "request:2");
  assert.equal(state.announcement, state.current, "The failed retry is announced through the same surface");
  const dismissed = dismissCurrentNotification(state);
  assert.equal(receiveNotification(dismissed, "assistantBusy", retry, 101), dismissed,
    "The same attempt cannot notify again");
  assert.equal(receiveNotification(dismissed, "voiceDenied", {
    scope: "assistant", operation: "voice:1", currentAttempt: true,
  }, 102), dismissed, "Voice hints still obey the global cooldown");
});

test("every current assistant request failure is visible without broadening other attempt feedback", () => {
  const failures = [400, 409, 413, 422, 429, 503, 504, 500]
    .map(status => assistantFailureNotification(new AssistantServiceError(status)));
  failures.push("assistantProjectChanged", assistantFailureNotification(new AssistantServiceError(429, undefined, "provider_allowance_exhausted")));
  for (const code of ["model_output_invalid", "model_output_truncated", "edit_validation_failed"])
    failures.push(assistantFailureNotification(new AssistantServiceError(422, undefined, code)));
  for (const id of failures) {
    const recent = removeNotificationScope(receiveNotification(initialNotifications(), "voiceHoldShort", {
      scope: "assistant", operation: "voice:1", currentAttempt: true,
    }, 0), "assistant");
    const failed = receiveNotification({ ...recent, busy: true }, id, {
      scope: "assistant", operation: "request:1", currentAttempt: true,
    }, 100);
    assert.equal(failed.current.id, id);
    assert.equal(failed.unresolved.length, 0);
    assert.equal(receiveNotification(recent, id, { scope: "assistant", operation: "background" }, 101), recent,
      "A background event cannot use the current-attempt exception");
    assert.equal(receiveNotification(recent, id, { scope: "assistant", currentAttempt: true }, 101), recent,
      "A distinct operation is required");
  }
  let guarded = receiveNotification(initialNotifications(), "saveFailed", { scope: "project" }, 0);
  guarded = removeNotificationScope(guarded, "assistant");
  assert.equal(receiveNotification(guarded, "assistantBusy", {
    scope: "assistant", operation: "request:2", currentAttempt: true,
  }, 100), guarded, "Usage-limit feedback cannot displace a visible save failure");
});

test("exhausted provider allowance has distinct bounded copy and never reports private diagnostic text", () => {
  const error = new AssistantServiceError(429, "private provider detail", "provider_allowance_exhausted");
  const id = assistantFailureNotification(error);
  assert.equal(id, "assistantAllowanceExhausted");
  assert.equal(notificationCatalog[id].message, "AI provider allowance used up.");
  assert.equal(notificationCatalog[id].kind, "warning");
  assert.equal(assistantFailureNotification(new AssistantServiceError(429)), "assistantBusy");
  assert.equal(assistantFailureNotification(new AssistantServiceError(503, undefined, "provider_allowance_exhausted")), "assistantUnavailable");
});

test("AI response failures distinguish malformed, truncated and rejected edits without blaming the request", () => {
  for (const [code, notification] of [
    ["model_output_invalid", "assistantResponseInvalid"],
    ["model_output_truncated", "assistantResponseIncomplete"],
    ["edit_validation_failed", "assistantValidationFailed"],
  ]) {
    const error = new AssistantServiceError(422, "private rejected source", code);
    assert.equal(assistantFailureNotification(error), notification);
    assert.match(error.message, /No changes were applied/);
    assert.doesNotMatch(error.message, /private/);
    assert.ok(notificationCatalog[notification].message.length <= 50);
    assert.doesNotMatch(notificationCatalog[notification].message, /not supported|rephrase/i);
  }
  assert.equal(assistantFailureNotification(new AssistantServiceError(422)), "assistantResponseInvalid");
});

test("event, scope, and operation identify duplicates while a new operation remains distinct", () => {
  const options = { scope: "component:1", operation: "attempt:1", currentAttempt: true };
  let state = receiveNotification(initialNotifications(), "assistantFailed", options, 0);
  state = dismissCurrentNotification(state);
  assert.equal(receiveNotification(state, "assistantFailed", options, 20_000), state);
  state = receiveNotification(state, "assistantFailed", { ...options, operation: "attempt:2" }, 20_000);
  assert.equal(state.current.operation, "attempt:2");
  state = dismissCurrentNotification(state);
  state = receiveNotification(state, "assistantFailed", { ...options, scope: "component:2" }, 30_000);
  assert.equal(state.current.scope, "component:2");
});

test("known flash limitations notify only once per camera scope", () => {
  let state = receiveNotification(initialNotifications(), "flashUnavailable", { scope: "camera:front", operation: "one" }, 0);
  state = dismissCurrentNotification(state);
  assert.equal(receiveNotification(state, "flashUnavailable", { scope: "camera:front", operation: "two" }, 20_000), state);
  state = receiveNotification(state, "flashUnavailable", { scope: "camera:rear" }, 20_000);
  assert.equal(state.current.scope, "camera:rear");
});

test("durable failures protect the current banner and retain a second failure after dismissal", () => {
  let state = receiveNotification(initialNotifications(), "saveFailed", { scope: "project" }, 0);
  const first = state.current;
  assert.equal(receiveNotification(state, "assistantFailed", { currentAttempt: true }, 20_000), state);
  state = receiveNotification(state, "recordingFailed", { scope: "recording:12" }, 21_000);
  assert.equal(state.current, first);
  assert.deepEqual(state.unresolved.map(issue => issue.id), ["saveFailed", "recordingFailed"]);
  state = dismissCurrentNotification(state);
  assert.equal(state.current, null, "Dismiss does not automatically replay a queue");
  assert.equal(state.unresolved.length, 2);
  assert.equal(receiveNotification(state, "saveFailed", { scope: "project" }, 30_000), state, "An acknowledged unresolved event does not reopen");
  state = resolveNotificationEvent(state, "saveFailed", "project");
  assert.deepEqual(state.unresolved.map(issue => issue.id), ["recordingFailed"]);
  state = receiveNotification(state, "saveFailed", { scope: "project" }, 40_000);
  assert.equal(state.current.id, "saveFailed", "A genuinely recovered operation can fail again");
});

test("leaving one scope clears its notices and dedupe without losing project issues or cooldown", () => {
  let state = receiveNotification(initialNotifications(), "assistantFailed", { scope: "component:1" }, 0);
  state = receiveNotification(state, "saveFailed", { scope: "project" }, 1);
  state = removeNotificationScope(state, "component:1");
  assert.equal(state.current.id, "saveFailed");
  assert.equal(state.unresolved.length, 1);
  assert.equal(state.seen.some(event => event.scope === "component:1"), false);
  assert.equal(state.lastBriefAt, 0);
});

test("store dismissal preserves accessible issues and reopening does not announce twice", () => {
  resetNotifications();
  notify("saveFailed", { scope: "project" });
  notify("restoreFailed", { scope: "project" });
  assert.equal(useNotifications.getState().unresolved.length, 2);
  dismissNotification();
  const restored = useNotifications.getState().unresolved.find(issue => issue.id === "restoreFailed");
  showNotificationIssue(restored.key);
  assert.equal(useNotifications.getState().current.id, "restoreFailed");
  assert.equal(useNotifications.getState().announcement, null);
  resolveNotification("restoreFailed", "project");
  assert.equal(useNotifications.getState().current, null);
  assert.equal(useNotifications.getState().unresolved.length, 1);
  clearNotificationScope("project");
  assert.equal(useNotifications.getState().unresolved.length, 0);
  resetNotifications();
});


test("approved assistant Undo feedback is immediate but never hides durable issues or blocks failures", () => {
  let state = receiveNotification(initialNotifications(), "assistantApplied", {
    operation: "first", currentAttempt: true, summary: "Text added · Clip trimmed",
  }, 100);
  assert.equal(state.current.summary, "Text added · Clip trimmed");
  assert.equal(state.current.action, "undoAssistantEdit");
  assert.equal(state.lastBriefAt, null, "Success feedback cannot consume a later failure's cooldown");
  state = receiveNotification(state, "assistantApplied", { operation: "second", currentAttempt: true }, 200);
  assert.equal(state.current.operation, "second");
  state = receiveNotification(state, "assistantFailed", { currentAttempt: true }, 201);
  assert.equal(state.current.id, "assistantFailed");
  state = receiveNotification(state, "saveFailed", {}, 300);
  assert.equal(receiveNotification(state, "assistantApplied", { operation: "third", currentAttempt: true }, 301), state);
  const unapproved = receiveNotification(initialNotifications(), "assistantFailed", { summary: "Free-form text" }, 400);
  assert.equal(unapproved.current.summary, undefined);
  assert.equal(unapproved.current.action, undefined);
});
