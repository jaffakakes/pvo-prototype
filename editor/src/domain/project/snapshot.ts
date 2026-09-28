import { layerOrder } from "../layers/order";
import { cloneLook } from "../components/look";
import type { Outcome, PvoComponent, Scene } from "./model";

export const cloneOutcome = (outcome: Outcome): Outcome => outcome.kind === "request"
  ? { ...outcome, onSuccess: { ...outcome.onSuccess }, onError: outcome.onError && { ...outcome.onError } }
  : { ...outcome };
export const cloneComponent = (component: PvoComponent): PvoComponent => ({
  ...component,
  archivedCode: component.archivedCode && structuredClone(component.archivedCode),
  ...(component.look ? { look: cloneLook(component.look) } : {}),
  fields: {
    ...component.fields,
    buttons: component.fields.buttons?.map(button => ({ ...button, outcome: button.outcome && cloneOutcome(button.outcome) })),
    options: component.fields.options?.map(option => ({ ...option, outcome: cloneOutcome(option.outcome) })),
    fieldKinds: component.fields.fieldKinds?.slice(),
    formFields: component.fields.formFields?.map(field => ({ ...field })),
    successOutcome: component.fields.successOutcome && { ...component.fields.successOutcome },
    failureOutcome: component.fields.failureOutcome && { ...component.fields.failureOutcome },
    outcome: component.fields.outcome && cloneOutcome(component.fields.outcome),
  },
  code: component.code && {
    ...component.code,
    pvo: component.code.pvo && { ...component.code.pvo },
    pvoLastValid: component.code.pvoLastValid && { ...component.code.pvoLastValid },
    pvoCompiled: component.code.pvoCompiled && structuredClone(component.code.pvoCompiled),
  },
});
export const cloneScenes = (scenes: Scene[]): Scene[] => scenes.map(scene => ({
  ...scene,
  clips: scene.clips.map(clip => ({ ...clip })),
  ...(scene.audioClips ? { audioClips: scene.audioClips.map(clip => ({ ...clip })) } : {}),
  texts: scene.texts.map(text => ({ ...text, style: text.style && { ...text.style } })),
  layers: layerOrder(scene),
  components: scene.components.map(cloneComponent),
}));
