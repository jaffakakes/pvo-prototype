import {
  clearResponseProgress,
  invalidateActionOperations,
  invalidatePlaybackNavigation,
} from "../actions/operations.js";
import { updateRequestStatus } from "../actions/request-status.js";
import { reportPlayerDiagnostic } from "../actions/diagnostics.js";
import { reachedResponseBoundaries } from "./transition-policy.js";

/** The transition controller can inspect playback facts and issue these session-owned commands. */
export function createPlaybackTransitionState(session) {
  return {
    read() {
      return {
        awaitingComponent: session.awaitingComponent,
        finished: session.finished,
        switchingClip: session.switchingClip,
        captureMode: session.captureMode,
        currentClipIndex: session.currentClipIndex,
        clipCount: session.currentTimeline?.clips.length ?? 0,
      };
    },
    boundaries(components, localTime) {
      return reachedResponseBoundaries(
        components,
        session.handledResponses,
        localTime,
      ).map((component) => ({
        component,
        response: session.capturedResponses.get(component.id),
        hidden: session.forcedHidden.has(component.id),
      }));
    },
    markHandled(componentId) {
      session.handledResponses.add(componentId);
    },
    hold(component, pause) {
      session.awaitingComponent = component;
      pause();
      reportPlayerDiagnostic(
        session,
        "playback.hold",
        session.capturedResponses.get(component.id)?.diagnostic,
        {
          componentId: component.id,
          reason: session.capturedResponses.has(component.id)
            ? "applying_response"
            : "awaiting_answer",
        },
      );
    },
    releaseHold() {
      session.awaitingComponent = null;
    },
    finish(pause) {
      invalidatePlaybackNavigation(session);
      pause();
      session.finished = true;
      session.awaitingComponent = null;
    },
    resetForRestart() {
      if (!session.manifest) return null;
      invalidatePlaybackNavigation(session);
      invalidateActionOperations(session);
      clearResponseProgress(session);
      session.forcedVisible = new Set();
      session.forcedHidden = new Set();
      session.finished = false;
      session.renderedOverlayKey = "";
      return session.manifest.playback.initial_timeline;
    },
    selectTimeline(timeline) {
      session.currentTimeline = timeline;
    },
    refreshRequestStatus(setStatus) {
      updateRequestStatus(session, setStatus);
    },
  };
}
