import { sceneDuration } from "../../domain/audio/editing";
import type { PvoRuntime } from "../../../../packages/pvo-sdk/index.js";
import {
  createPvoRuntime,
  PVO_SPEC_VERSION,
} from "../../../../packages/pvo-sdk/index.js";
import {
  actionFor,
  collectRequestDomains,
} from "../../domain/components/actions";
import { branchRoutes, branchesAtEnd } from "../../domain/components/branching";
import {
  formSubmissionOutcome,
  formValuesForSubmission,
  validateFormFields,
} from "../../domain/components/forms";
import { componentEnd } from "../../domain/components/timing";
import { layerZ } from "../../domain/layers/order";
import type {
  Outcome,
  PlaybackOutcome,
  PvoComponent,
} from "../../domain/project/model";
import { clamp } from "../../domain/project/numbers";
import type { CaptureState, TryMode } from "../../state/types";

type TrySessionState = Pick<
  CaptureState,
  | "currentSceneId"
  | "t"
  | "sel"
  | "selComp"
  | "selText"
  | "sheet"
  | "scenes"
  | "clips"
  | "components"
  | "texts"
  | "layers"
  | "allowedDomains"
  | "tryMode"
  | "patch"
  | "switchScene"
>;
type Host = {
  getState(): TrySessionState;
  request: typeof fetch;
  feedback(): Record<string, { phase: string }>;
  clearFeedback(): void;
  clearNotice(): void;
  startFailed(): void;
  emptyScene(id: string): void;
  beginRequest(id: string): number;
  finishRequest(id: string, operation: number, failed: boolean): void;
};

const freshMode = (): TryMode => ({ playing: true, holdingId: null, handled: [], answers: {} });

/**
 * Viewer preview follows the format note: components show for their layer,
 * explicit routes act on tap, a choice with "Branch at layer end" remembers the
 * answer and opens its scene when the layer ends, waiting there if unanswered,
 * and a chosen scene is the rest of the video.
 */
export function createTrySession(host: Host) {
  let tryRuntime: PvoRuntime | null = null;
  type EditingLocation = Pick<
    TrySessionState,
    "currentSceneId" | "t" | "sel" | "selComp" | "selText" | "sheet"
  >;
  let editingLocation: EditingLocation | null = null;
  function getTryRuntime() {
    return tryRuntime;
  }
  function componentFromContext(context: Record<string, unknown>) {
    const id = context.componentId;
    return typeof id === "string"
      ? host.getState().components.find((item) => item.id === id)
      : undefined;
  }
  function createTryRuntime(state: TrySessionState) {
    const allowed_domains = collectRequestDomains(
      state.scenes,
      state.allowedDomains,
    );
    let runtime: PvoRuntime;
    const active = () => tryRuntime === runtime && !!host.getState().tryMode;
    runtime = createPvoRuntime(
      {
        spec_version: PVO_SPEC_VERSION,
        scenes: [{ id: "main", start: 0, end: 1 }],
        components: [],
        allowed_domains,
      },
      {
        gotoScene: (sceneId, context) => {
          if (!active()) return;
          const component = componentFromContext(context);
          if (component)
            runPlaybackOutcome(component, { kind: "scene", sceneId });
        },
        seek: (time, context) => {
          if (!active()) return;
          const component = componentFromContext(context);
          if (component)
            runPlaybackOutcome(component, { kind: "time", t: time });
        },
        custom: (name, _payload, context) => {
          if (!active()) return;
          const component = componentFromContext(context);
          if (name === "restyle_continue" && component)
            runPlaybackOutcome(component, { kind: "continue" });
        },
        request: ({ url, ...options }) =>
          host.request(url, {
            ...options,
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
          }),
      },
    );
    return runtime;
  }
  function startTry() {
    const s = host.getState();
    if (s.tryMode || sceneDuration(s) <= 0) return;
    try {
      host.clearFeedback();
      host.clearNotice();
      tryRuntime = createTryRuntime(s);
    } catch (error) {
      console.error("Could not start viewer preview:", error);
      host.startFailed();
      return;
    }
    editingLocation = {
      currentSceneId: s.currentSceneId,
      t: s.t,
      sel: s.sel,
      selComp: s.selComp,
      selText: s.selText,
      sheet: s.sheet,
    };
    // The workspace hides the mounted editing region so its tab and height survive Try.
    s.patch({
      tryMode: freshMode(),
      playing: true,
      t: s.t >= sceneDuration(s) ? 0 : s.t,
      orb: false,
      ratioMenu: false,
    });
  }
  function stopTry() {
    tryRuntime = null;
    host.clearFeedback();
    host.clearNotice();
    const state = host.getState();
    const location = editingLocation;
    editingLocation = null;
    state.patch({
      ...(location &&
      state.scenes.some((scene) => scene.id === location.currentSceneId)
        ? location
        : {}),
      tryMode: null,
      playing: false,
    });
  }
  /** A chosen scene is the rest of the video: nothing returns to the scene that routed there. */
  function enterScene(component: PvoComponent, sceneId: string): boolean {
    const s = host.getState();
    const target = s.scenes.find((scene) => scene.id === sceneId);
    if (!target || sceneDuration(target) <= 0) {
      host.emptyScene(component.id);
      return false;
    }
    host.clearFeedback();
    s.switchScene(target.id, { undoable: false, preserveTry: true });
    host.getState().patch({ tryMode: freshMode(), t: 0, playing: true });
    return true;
  }
  function branchTarget(component: PvoComponent, answer: boolean): string | null {
    const routes = branchRoutes(component);
    return routes ? (answer ? routes.trueSceneId : routes.falseSceneId) : null;
  }
  /** A branch-at-end choice remembers the tap; the branch itself waits for the layer to end. */
  function recordAnswer(component: PvoComponent, answer: boolean) {
    const s = host.getState();
    const mode = s.tryMode;
    if (!mode) return;
    const answers = { ...mode.answers, [component.id]: answer };
    if (mode.holdingId !== component.id) {
      s.patch({ tryMode: { ...mode, answers } });
      return;
    }
    const target = branchTarget(component, answer);
    if (target && enterScene(component, target)) return;
    s.patch({
      tryMode: { ...mode, playing: true, holdingId: null, handled: [...mode.handled, component.id], answers },
      playing: true,
    });
  }
  function runPlaybackOutcome(
    component: PvoComponent,
    outcome: PlaybackOutcome,
  ) {
    const s = host.getState();
    const mode = s.tryMode;
    if (!mode) return;
    const routes = branchesAtEnd(component) ? branchRoutes(component) : null;
    if (routes && outcome.kind === "scene") {
      recordAnswer(component, outcome.sceneId === routes.trueSceneId);
      return;
    }
    if (outcome.kind === "scene") {
      enterScene(component, outcome.sceneId);
      return;
    }
    // Another component's plain continue cannot release a choice waiting at its layer end.
    if (outcome.kind === "continue" && mode.holdingId && mode.holdingId !== component.id) return;
    const t = outcome.kind === "time" ? clamp(outcome.t, 0, sceneDuration(s)) : s.t;
    // Seeking back before a finished branch point lets that choice ask again.
    const handled =
      t < s.t
        ? mode.handled.filter((id) => {
            const item = s.components.find((candidate) => candidate.id === id);
            return !!item && componentEnd(item, s.clips) < t;
          })
        : mode.handled;
    s.patch({
      t,
      tryMode: { ...mode, playing: true, holdingId: null, handled },
      playing: true,
    });
  }
  /** Execute a field-authored action with the same SDK request policy as an exported PVO. */
  async function runOutcome(
    component: PvoComponent,
    outcome: Outcome,
    formValues?: Record<string, string | number | boolean>,
  ) {
    const state = host.getState();
    if (!state.tryMode) return;
    if (
      outcome.kind === "request" &&
      host.feedback()[component.id]?.phase === "pending"
    )
      return;
    if (formValues && component.type === "form") {
      if (!/^[A-Za-z0-9_-]+$/.test(component.id))
        throw new Error("Form ID contains unsupported characters.");
      tryRuntime?.setState(`form.${component.id}`, formValues);
    }
    if (outcome.kind !== "request") {
      runPlaybackOutcome(component, outcome);
      return;
    }
    if (!tryRuntime) return;
    const runtime = tryRuntime;
    const operation = host.beginRequest(component.id);
    let actionReady = false;
    try {
      const action = actionFor(outcome, component.id);
      actionReady = true;
      await runtime.execute(action, {
        componentId: component.id,
        throwOnRequestError: true,
      });
      host.finishRequest(component.id, operation, false);
    } catch (error) {
      // No error route is deliberately a no-op: the component stays available to retry.
      console.warn("PVO request failed in Try mode:", error);
      const latest = host.getState();
      if (
        runtime === tryRuntime &&
        latest.tryMode &&
        latest.currentSceneId === state.currentSceneId
      ) {
        // Authored error routes already communicated the result. An empty-scene
        // route has its own operation key, so completion cannot erase its status.
        host.finishRequest(
          component.id,
          operation,
          !(actionReady && outcome.onError),
        );
      }
    }
  }
  /** Form answers stay in session state; only an explicit request sends them to a destination. */
  async function runFormSubmission(
    component: PvoComponent,
    values: Record<string, string>,
  ): Promise<void> {
    if (
      !host.getState().tryMode ||
      host.feedback()[component.id]?.phase === "pending"
    )
      return;
    try {
      if (component.fields.formFields)
        validateFormFields(component.fields.formFields);
      const outcome = formSubmissionOutcome(component);
      if (!outcome) {
        if (component.fields.failureOutcome)
          runPlaybackOutcome(component, component.fields.failureOutcome);
        else {
          const operation = host.beginRequest(component.id);
          host.finishRequest(component.id, operation, true);
        }
        return;
      }
      const formValues = formValuesForSubmission(component.fields, values);
      await runOutcome(component, outcome, formValues);
    } catch (error) {
      console.warn("Could not submit form in Try mode:", error);
      const operation = host.beginRequest(component.id);
      host.finishRequest(component.id, operation, true);
    }
  }
  /** Returns true when an end-of-layer branch or the end of the video consumed this playback frame. */
  function advanceTry(s: TrySessionState, next: number) {
    const mode = s.tryMode;
    if (!mode) return false;
    // A choice covered by the opaque video cannot wait for a tap nobody can see.
    const ending = s.components
      .filter(
        (component) =>
          branchesAtEnd(component) &&
          layerZ(s, `component:${component.id}`) > layerZ(s, "video") &&
          !mode.handled.includes(component.id),
      )
      .map((component) => ({ component, end: componentEnd(component, s.clips) }))
      .filter(({ end }) => end >= s.t - 0.001 && end <= next + 0.001)
      .sort((a, b) => a.end - b.end)[0];
    if (ending) {
      const answer = mode.answers[ending.component.id];
      if (answer === undefined) {
        s.patch({
          t: ending.end,
          playing: false,
          tryMode: { ...mode, playing: false, holdingId: ending.component.id },
        });
        return true;
      }
      const target = branchTarget(ending.component, answer);
      if (target && enterScene(ending.component, target)) return true;
      s.patch({
        t: ending.end,
        tryMode: { ...mode, handled: [...mode.handled, ending.component.id] },
      });
      return true;
    }
    if (next < sceneDuration(s)) return false;
    // The video ends with its timeline; a selected branch is the ending.
    stopTry();
    return true;
  }

  return {
    getTryRuntime,
    startTry,
    stopTry,
    runOutcome,
    runFormSubmission,
    advanceTry,
  };
}
