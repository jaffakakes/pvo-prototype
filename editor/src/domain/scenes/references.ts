import { fieldsShownFor } from "../components/fields";
import type { Outcome, PlaybackOutcome, PvoComponent, Scene } from "../project/model";
import { clearDeletedLanguageRoutes } from "./languageReferences";
import { sceneSubtreeIds } from "./rules";

function clearPlayback(outcome: PlaybackOutcome, deleted: ReadonlySet<string>): PlaybackOutcome {
  return outcome.kind === "scene" && deleted.has(outcome.sceneId) ? { kind: "continue" } : outcome;
}

export function clearDeletedOutcome(outcome: Outcome, deleted: ReadonlySet<string>): Outcome {
  if (outcome.kind !== "request") return clearPlayback(outcome, deleted);
  const onSuccess = clearPlayback(outcome.onSuccess, deleted);
  const onError = outcome.onError && clearPlayback(outcome.onError, deleted);
  return onSuccess === outcome.onSuccess && onError === outcome.onError
    ? outcome : { ...outcome, onSuccess, onError };
}

function clearDeletedCodeRoutes(code: PvoComponent["code"], deleted: ReadonlySet<string>): PvoComponent["code"] {
  return code && {
    ...code,
    pvo: code.pvo && { ...code.pvo, logic: clearDeletedLanguageRoutes(code.pvo.logic, deleted) },
    pvoLastValid: code.pvoLastValid && { ...code.pvoLastValid, logic: clearDeletedLanguageRoutes(code.pvoLastValid.logic, deleted) },
    pvoCompiled: code.pvoCompiled && {
      ...code.pvoCompiled,
      rules: code.pvoCompiled.rules.map(rule => ({ ...rule, action: clearDeletedOutcome(rule.action, deleted) })),
    },
  };
}

export function clearDeletedComponentRoutes(component: PvoComponent, deleted: ReadonlySet<string>): PvoComponent {
  const clear = (outcome: Outcome | undefined) => outcome && clearDeletedOutcome(outcome, deleted);
  const fields = {
    ...component.fields,
    buttons: component.fields.buttons?.map(button => ({ ...button, outcome: clear(button.outcome) })),
    options: component.fields.options?.map(option => ({ ...option, outcome: clearDeletedOutcome(option.outcome, deleted) })),
    outcome: clear(component.fields.outcome),
    successOutcome: component.fields.successOutcome && clearPlayback(component.fields.successOutcome, deleted),
    failureOutcome: component.fields.failureOutcome && clearPlayback(component.fields.failureOutcome, deleted),
  };
  return {
    ...component, fields,
    code: clearDeletedCodeRoutes(component.code, deleted),
    archivedCode: clearDeletedCodeRoutes(component.archivedCode, deleted),
  };
}

export type SceneDeletionImpact = {
  sceneId: string;
  sceneName: string;
  componentId: string;
  componentName: string;
  outcomes: string[];
};

export function sceneRouteLabel(scenes: readonly Scene[], targetId: string): string | null {
  const pointsTo = (outcome: Outcome | undefined): boolean => {
    if (outcome?.kind === "scene") return outcome.sceneId === targetId;
    return outcome?.kind === "request" && (pointsTo(outcome.onSuccess) || pointsTo(outcome.onError ?? undefined));
  };
  for (const scene of scenes) {
    for (const component of scene.components) {
      const fields = fieldsShownFor(component);
      const control = [...fields.options ?? [], ...fields.buttons ?? []].find(item => pointsTo(item.outcome));
      if (control) return control.label;
      if (pointsTo(fields.outcome)) return fields.submitLabel || "Submit";
      if (pointsTo(fields.successOutcome) || pointsTo(fields.failureOutcome ?? undefined)) return fields.submitLabel || "Submit";
    }
  }
  return null;
}

export function deletionImpact(scenes: readonly Scene[], id: string): SceneDeletionImpact[] {
  if (id === "main") return [];
  const deleted = sceneSubtreeIds(scenes, id);
  const affected: SceneDeletionImpact[] = [];
  for (const scene of scenes) {
    if (deleted.has(scene.id)) continue;
    for (const component of scene.components) {
      const outcomes = new Set<string>();
      const inspect = (outcome: Outcome | undefined, label: string) => {
        if (outcome?.kind === "scene" && deleted.has(outcome.sceneId)) outcomes.add(label);
        if (outcome?.kind === "request") {
          if (clearPlayback(outcome.onSuccess, deleted) !== outcome.onSuccess) outcomes.add(`${label} · success`);
          if (outcome.onError && clearPlayback(outcome.onError, deleted) !== outcome.onError) outcomes.add(`${label} · error`);
        }
      };
      const fields = fieldsShownFor(component);
      fields.buttons?.forEach(button => inspect(button.outcome, button.label));
      fields.options?.forEach(option => inspect(option.outcome, option.label));
      inspect(fields.outcome, fields.submitLabel || "Submit");
      inspect(fields.successOutcome, `${fields.submitLabel || "Submit"} · success`);
      inspect(fields.failureOutcome ?? undefined, `${fields.submitLabel || "Submit"} · error`);
      if (!outcomes.size) {
        component.code?.pvoCompiled?.rules.forEach(rule => inspect(rule.action, rule.target || "Submit"));
        const logic = component.code?.pvo?.logic;
        if (logic && clearDeletedLanguageRoutes(logic, deleted) !== logic) outcomes.add("PVO Logic");
      }
      const saved = component.archivedCode;
      if (saved?.pvoCompiled?.rules.some(rule => clearDeletedOutcome(rule.action, deleted) !== rule.action)
        || (saved?.pvo && clearDeletedLanguageRoutes(saved.pvo.logic, deleted) !== saved.pvo.logic))
        outcomes.add("Saved PVO Logic");
      if (outcomes.size) affected.push({
        sceneId: scene.id, sceneName: scene.name, componentId: component.id,
        componentName: fields.title || fields.prompt || fields.heading || fields.text || fields.submitLabel || component.type,
        outcomes: [...outcomes],
      });
    }
  }
  return affected;
}
