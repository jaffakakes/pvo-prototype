export function createOutcomeRouter({ session, refs, adapters }) {
  function routeForAnswer(component, answer) {
    const condition = answer ? "true" : "false";
    return component.scene_change?.routes?.find((route) => route.condition === condition) || null;
  }

  /** The editor-authored outcome for a control, used when its executed actions did not route. */
  function captureOutcome(component, index) {
    const specified = component.restyle_capture?.outcomes?.[index];
    if (specified) return specified;
    const action = component.kind === "choice" ? component.options?.[index]?.action
      : component.kind === "card" ? component.actions?.[index]?.action
      : component.on_submit;
    if (action?.type === "goto_scene") return { kind: "scene", sceneId: action.scene };
    if (action?.type === "seek") return { kind: "time", t: action.time };
    return { kind: "continue" };
  }

  /** One rule for every package: explicit routes act now; scene_change branches when the layer ends. */
  async function applyActionOutcome(component, index, outcome) {
    const wasAwaiting = session.awaitingComponent?.id === component.id;
    if (outcome?.kind === "scene") {
      session.awaitingComponent = null;
      const target = adapters.captureTimelineForScene(outcome.sceneId);
      if (!target) throw new Error("That scene is not available in this PVO.");
      session.currentTimeline = target;
      adapters.renderOverlays(true);
      await adapters.loadClip(0, true);
      return;
    }
    if (outcome?.kind === "time") {
      session.awaitingComponent = null;
      await adapters.seekToElapsed(outcome.t, true);
      return;
    }
    if (component.scene_change?.enabled) {
      if (wasAwaiting) await adapters.startSelectedBranch(component);
      else await refs.video.play().catch(() => adapters.showControls());
    } else {
      session.awaitingComponent = null;
      await refs.video.play().catch(() => adapters.showControls());
    }
    adapters.renderOverlays(true);
  }

  return { captureOutcome, applyActionOutcome, routeForAnswer };
}
