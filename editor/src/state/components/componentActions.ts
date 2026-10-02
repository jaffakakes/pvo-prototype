import { changeComponent, createDefaultComponent } from "../../domain/components/editing";
import { total } from "../../domain/clips/timing";
import { fieldsShownFor } from "../../domain/components/fields";
import { editComponentAction } from "../../domain/components/languageActionEditing";
import { clampComponentStart } from "../../domain/components/timing";
import { remapComponentReferences } from "../../domain/components/requestReferences";
import {
  acceptsResponse,
  responsePolicyFor,
} from "../../domain/components/responsePolicy";
import type { PvoComponent } from "../../domain/project/model";
import { cloneComponent, cloneOutcome } from "../../domain/project/snapshot";
import { uid } from "../../infrastructure/ids";
import { playheadAfterSceneTimingChange } from "../project/playheadBounds";
import type { CaptureState } from "../types";

function releaseUnansweredHold(
  state: CaptureState,
  previous: PvoComponent,
  next: PvoComponent,
): Pick<CaptureState, "playing" | "tryMode"> | null {
  const mode = state.tryMode;
  // A captured response uses the same hold while its layer-end outcome settles;
  // changing the unanswered policy must not bypass that work.
  if (
    !mode ||
    mode.holdingId !== previous.id ||
    mode.capturedResponses[previous.id] !== undefined ||
    !acceptsResponse(previous) ||
    !acceptsResponse(next) ||
    responsePolicyFor(previous).unanswered !== "pause" ||
    responsePolicyFor(next).unanswered !== "continue"
  )
    return null;
  return {
    playing: true,
    tryMode: {
      ...mode,
      playing: true,
      holdingId: null,
      handled: mode.handled.includes(previous.id)
        ? mode.handled
        : [...mode.handled, previous.id],
    },
  };
}

export function createComponentActions(get: () => CaptureState): Pick<CaptureState, "addComponent" | "updateComponent" | "updateOutcome" | "deleteComponent" | "duplicateComponent"> {
  return {
    addComponent: type => {
      const state = get();
      const id = `component-${uid()}`;
      const scene = state.scenes.find(item => item.id === state.currentSceneId)!;
      const component = createDefaultComponent(id, type, scene, state.t);
      state.edit({
        components: [...state.components, component], sel: -1, selComp: id,
        playing: false, orb: false, sheet: "component",
      });
      return id;
    },
    updateComponent: (id, changes, undoable = true, options) => {
      const state = get();
      const scene = state.scenes.find(item => item.components.some(component => component.id === id));
      if (!scene)
        return;
      const previous = scene.components.find(component => component.id === id)!;
      const components = scene.components.map(component => {
        if (component.id !== id) return component;
        return changeComponent(component, changes, scene);
      });
      if (components.every((component, index) => component === scene.components[index])) return;
      const updated = components.find(component => component.id === id)!;
      const release = releaseUnansweredHold(state, previous, updated);
      const updatedScene = { ...scene, components };
      const scenes = state.scenes.map(item => item.id === scene.id ? updatedScene : item);
      const timing = playheadAfterSceneTimingChange(
        state,
        updatedScene,
        options?.preservePlayhead,
      );
      const values = { scenes, ...(release ?? {}), ...timing };
      if (undoable)
        state.edit(values);
      else
        state.patch(values);
    },
    updateOutcome: (id, target, outcome, undoable = true) => {
      const state = get();
      const scene = state.scenes.find(item => item.components.some(component => component.id === id));
      const component = scene?.components.find(item => item.id === id);
      if (!component)
        return false;
      const fields = { ...fieldsShownFor(component) };
      if (target.kind === "form") {
        fields.outcome = cloneOutcome(outcome);
        fields.formSubmitMode = outcome.kind === "request" ? "request" : "local";
        fields.destination = outcome.kind === "request" ? outcome.url : "";
        fields.successOutcome = outcome.kind === "request" ? { ...outcome.onSuccess } : { ...outcome };
        fields.failureOutcome = outcome.kind === "request" && outcome.onError ? { ...outcome.onError } : null;
      }
      else if (target.kind === "button" && target.index !== undefined && fields.buttons?.[target.index]) {
        fields.buttons = fields.buttons.map((button, index) => index === target.index ? { ...button, outcome: cloneOutcome(outcome) } : button);
      }
      else if (target.kind === "option" && target.index !== undefined && fields.options?.[target.index]) {
        fields.options = fields.options.map((option, index) => index === target.index ? { ...option, outcome: cloneOutcome(outcome) } : option);
      }
      else
        return false;
      const changes = editComponentAction(component, fields, target, outcome);
      if (!changes) return false;
      state.updateComponent(id, changes, undoable);
      return true;
    },
    deleteComponent: id => {
      const state = get();
      const scene = state.scenes.find(item => item.components.some(component => component.id === id));
      if (!scene)
        return;
      const updatedScene = {
        ...scene,
        components: scene.components.filter(component => component.id !== id),
      };
      const scenes = state.scenes.map(item => item.id === scene.id ? updatedScene : item);
      state.edit({
        scenes,
        selComp: state.selComp === id ? null : state.selComp,
        sheet: state.sheet === "component" ? null : state.sheet,
        ...playheadAfterSceneTimingChange(state, updatedScene),
      });
    },
    duplicateComponent: id => {
      const state = get();
      const scene = state.scenes.find(item => item.components.some(component => component.id === id));
      const component = scene?.components.find(item => item.id === id);
      if (!scene || !component)
        return null;
      const newId = `component-${uid()}`;
      const copy = remapComponentReferences(cloneComponent(component), new Map([[component.id, newId]]));
      copy.id = newId;
      copy.at = clampComponentStart(
        component.at + 1,
        copy.dur,
        total(scene.clips),
      );
      state.updateScene(scene.id, { components: [...scene.components, copy] });
      get().patch({ currentSceneId: scene.id, sel: -1, selComp: newId, t: copy.at });
      return newId;
    }
  };
}
