import { DEFAULT_TEXT_STYLE } from "../../../../packages/pvo-text-runtime/index.js";
import { total } from "../../domain/clips/timing";
import { constrainOverlayPosition } from "../../domain/layers/transform";
import { clamp } from "../../domain/project/numbers";
import { uid } from "../../infrastructure/ids";
import type { CaptureState } from "../types";

export function createTextActions(get: () => CaptureState): Pick<CaptureState, "addText" | "updateText" | "deleteText" | "duplicateText"> {
  return {
    addText: (text, style = DEFAULT_TEXT_STYLE) => {
      const state = get(), length = total(state.clips), id = uid();
      const start = clamp(state.t, 0, Math.max(0, length - .3));
      state.edit({ texts: [...state.texts, { id, text, style: { ...style }, color: 2, start, end: Math.min(length, start + 3), x: 50, y: 45 }], selText: id, playing: false });
      return id;
    },
    updateText: (id, changes, undoable = true) => {
      const state = get();
      const values = { texts: state.texts.map(text => {
        if (text.id !== id) return text;
        const next = { ...text, ...changes, id };
        if (!("x" in changes) && !("y" in changes)) return next;
        return { ...next, ...constrainOverlayPosition({
          x: changes.x ?? text.x,
          y: changes.y ?? text.y,
        }) };
      }) };
      if (undoable)
        state.edit(values);
      else
        state.patch(values);
    },
    deleteText: id => {
      const state = get();
      state.edit({ texts: state.texts.filter(text => text.id !== id), selText: null, sheet: null });
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
