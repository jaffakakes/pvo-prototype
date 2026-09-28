import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export * from "./editor/src/domain/notifications/policy.ts";
      export { notificationCatalog } from "./editor/src/domain/notifications/catalog.ts";
      export * from "./editor/src/state/notifications/notificationStore.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { notificationCatalog, initialNotifications, receiveNotification, dismissCurrentNotification,
  resolveNotificationEvent, removeNotificationScope, useNotifications, notify, resolveNotification,
  clearNotificationScope, dismissNotification, showNotificationIssue, resetNotifications } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("catalogue copy is bounded and no routine success message is enabled", () => {
  for (const definition of Object.values(notificationCatalog)) {
    assert.ok(definition.message.length <= 50);
    assert.notEqual(definition.kind, "success");
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
  const attempted = receiveNotification(busy, "assistantUnsupported", { currentAttempt: true }, 0);
  assert.equal(attempted.current.id, "assistantUnsupported");
  const risk = receiveNotification(busy, "recordingFailed", { scope: "recording:12" }, 0);
  assert.equal(risk.current.id, "recordingFailed");
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
