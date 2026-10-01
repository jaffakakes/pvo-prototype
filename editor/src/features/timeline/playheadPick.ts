import { total } from "../../domain/clips/timing";
import { isCodeOwned } from "../../domain/components/codeOwnership";
import { fieldsShownFor } from "../../domain/components/fields";
import { formSubmissionOutcome, toVisualFormFields } from "../../domain/components/forms";
import { clampComponentStart } from "../../domain/components/timing";
import type { Outcome, OutcomeTarget } from "../../domain/project/model";
import { clamp } from "../../domain/project/numbers";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import type { PlayheadPick } from "../../state/types";

type PickTarget = {
  kind: "component-at";
  componentId: string;
} | {
  kind: "outcome-time";
  componentId: string;
  target: OutcomeTarget;
  branch: "success" | "error" | null;
} | {
  kind: "text-start";
  textId: number;
};
export function beginPlayheadPick(target: PickTarget) {
  const s = useCapture.getState();
  if (s.playheadPick || s.screen !== "editor" || sceneDuration(s) <= 0)
    return;
  s.patch({
    playheadPick: { ...target, sceneId: s.currentSceneId, originalT: s.t },
    playing: false, trim: null, orb: false, ratioMenu: false,
  });
}
export function cancelPlayheadPick() {
  const s = useCapture.getState();
  if (!s.playheadPick)
    return;
  s.patch({ t: s.playheadPick.originalT, playheadPick: null });
}
function outcomeAt(component: {
  fields: {
    buttons?: {
      outcome?: Outcome;
    }[];
    options?: {
      outcome: Outcome;
    }[];
    outcome?: Outcome;
  };
}, target: OutcomeTarget) {
  return target.kind === "button" ? component.fields.buttons?.[target.index ?? 0]?.outcome
    : target.kind === "option" ? component.fields.options?.[target.index ?? 0]?.outcome
      : component.fields.outcome;
}
export function acceptPlayheadPick() {
  const s = useCapture.getState();
  const pick: PlayheadPick | null = s.playheadPick;
  if (!pick)
    return;
  if (pick.sceneId !== s.currentSceneId) {
    cancelPlayheadPick();
    return;
  }
  const videoLength = total(s.clips);
  const length = sceneDuration(s);
  const time = clamp(s.t, 0, length);
  if (pick.kind === "component-at") {
    const component = s.components.find(item => item.id === pick.componentId);
    if (component) {
      const at = clampComponentStart(time, component.dur, videoLength);
      if (component.at !== at)
        s.updateComponent(component.id, { at }, true);
    }
  }
  else if (pick.kind === "text-start") {
    const text = s.texts.find(item => item.id === pick.textId);
    if (text) {
      const span = Math.max(0.1, text.end - text.start);
      const start = Math.max(0, time);
      if (text.start !== start)
        s.updateText(text.id, { start, end: start + span }, true);
    }
  }
  else {
    const component = s.components.find(item => item.id === pick.componentId);
    if (component) {
      const fields = fieldsShownFor(component);
      const current = pick.target.kind === "form" && fields.formFields && !fields.outcome
        ? formSubmissionOutcome({ id: component.id, fields })
        : outcomeAt({ fields }, pick.target);
      const route = { kind: "time" as const, t: time };
      if (pick.target.kind === "form" && pick.branch && !isCodeOwned(component) && current?.kind !== "request") {
        const visual = toVisualFormFields(fields);
        const field = pick.branch === "success" ? "successOutcome" : "failureOutcome";
        const previous = visual[field];
        if (previous?.kind !== "time" || previous.t !== time) {
          s.updateComponent(component.id, { fields: { ...visual, [field]: route } }, true);
        }
      }
      else if (pick.branch && current?.kind === "request") {
        const previous = pick.branch === "success" ? current.onSuccess : current.onError;
        if (previous?.kind !== "time" || previous.t !== time) {
          const changed = s.updateOutcome(component.id, pick.target, {
            ...current,
            ...(pick.branch === "success" ? { onSuccess: route } : { onError: route }),
          }, true);
          if (!changed) {
            s.patch({ playheadPick: { ...pick, error: "Fix this action’s Logic in Advanced first." } });
            return;
          }
        }
      }
      else if ((!pick.branch || pick.target.kind === "form" && pick.branch === "success") && (current?.kind !== "time" || current.t !== time)) {
        if (!s.updateOutcome(component.id, pick.target, route, true)) {
          s.patch({ playheadPick: { ...pick, error: "Fix this action’s Logic in Advanced first." } });
          return;
        }
      }
    }
  }
  useCapture.getState().patch({ playheadPick: null });
}
