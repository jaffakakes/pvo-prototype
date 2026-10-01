import { DEFAULT_TEXT_STYLE } from "../../../../packages/pvo-text-runtime/index.js";
import { constrainOverlayPosition } from "../../domain/layers/transform";
import { uid } from "../../infrastructure/ids";
import { playheadAfterSceneTimingChange } from "../project/playheadBounds";
import type { CaptureState } from "../types";

export function createTextActions(get: () => CaptureState): Pick<CaptureState, "addText" | "updateText" | "deleteText" | "duplicateText"> {
  return {
    addText: (text, style = DEFAULT_TEXT_STYLE) => {
      const state = get(), id = uid();
      const start = Math.max(0, state.t);
      state.edit({ texts: [...state.texts, { id, text, style: { ...style }, color: 2, start, end: start + 3, x: 50, y: 45 }], selText: id, playing: false });
      return id;
    },
    updateText: (id, changes, undoable = true, options) => {
      const state = get();
      const texts = state.texts.map(text => {
        if (text.id !== id) return text;
        const next = { ...text, ...changes, id };
        if (!("x" in changes) && !("y" in changes)) return next;
        return { ...next, ...constrainOverlayPosition({
          x: changes.x ?? text.x,
          y: changes.y ?? text.y,
        }) };
      });
      const scene = state.scenes.find(item => item.id === state.currentSceneId);
      const timing = scene
        ? playheadAfterSceneTimingChange(
            state,
            { ...scene, texts },
            options?.preservePlayhead,
          )
        : {};
      const values = { texts, ...timing };
      if (undoable)
        state.edit(values);
      else
        state.patch(values);
    },
    deleteText: id => {
      const state = get();
      const texts = state.texts.filter(text => text.id !== id);
      const scene = state.scenes.find(item => item.id === state.currentSceneId);
      const timing = scene
        ? playheadAfterSceneTimingChange(state, { ...scene, texts })
        : {};
      state.edit({ texts, selText: null, sheet: null, ...timing });
    },
    duplicateText: id => {
      const state = get(), original = state.texts.find(text => text.id === id);
      if (!original)
        return;
      const copy = { ...original, id: uid(), ...constrainOverlayPosition({ x: original.x, y: original.y + 5 }),
        style: original.style && { ...original.style } };
      state.edit({ texts: [...state.texts, copy], selText: copy.id });
    }
  };
}
