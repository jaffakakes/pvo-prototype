import test from "node:test";
import assert from "node:assert/strict";
import { createPlaybackSession } from "../player/playback/session.js";
import { playerViewState, formatDuration } from "../player/ui/view-state.js";

const form = { id: "form", kind: "form" };
const media = { paused: true, muted: true };

test("viewer hold keeps ownership through request failure and retry", () => {
  const session = createPlaybackSession();
  session.awaitingComponent = form;
  assert.deepEqual(playerViewState(session, media), { state: "waiting", component: form });
  session.pendingComponents.add(form.id);
  assert.equal(playerViewState(session, media).state, "submitting");
  session.failedRequestComponents.set(form.id, { kind: "network" });
  assert.equal(playerViewState(session, media).state, "submitting", "In-flight work owns the widget until it settles");
  session.pendingComponents.clear();
  assert.equal(playerViewState(session, media).state, "error");
  session.failedRequestComponents.clear();
  session.pendingComponents.add(form.id);
  assert.equal(playerViewState(session, media).state, "submitting");
  session.pendingComponents.clear();
  session.awaitingComponent = null;
  assert.equal(playerViewState(session, { paused: false, muted: false }).state, "playing");
});

test("deferred captured responses do not manufacture a playback hold", () => {
  const session = createPlaybackSession();
  session.capturedResponses.set(form.id, { status: "captured" });
  assert.equal(playerViewState(session, { paused: false, muted: true }, [form]).state, "autoplay");
  assert.equal(playerViewState(session, media, [form]).state, "paused");
});

test("request chrome stays attached to the active component and finished state wins", () => {
  const session = createPlaybackSession();
  session.failedRequestComponents.set("offscreen", { kind: "network" });
  assert.equal(playerViewState(session, media, [form]).state, "paused");
  session.pendingComponents.add(form.id);
  assert.equal(playerViewState(session, media, [form]).state, "submitting");
  session.finished = true;
  assert.deepEqual(playerViewState(session, media, [form]), { state: "finished", component: null });
});

test("video metadata uses bounded m:ss durations", () => {
  assert.equal(formatDuration(48.9), "0:48");
  assert.equal(formatDuration(123), "2:03");
  assert.equal(formatDuration(Infinity), "0:00");
  assert.equal(formatDuration(-1), "0:00");
});
