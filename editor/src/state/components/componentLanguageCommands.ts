import type { CompiledPvoComponent } from "../../../../packages/pvo-language/index.js";
import { compiledComponentChanges } from "../../domain/components/languageCompilation";
import type { PvoComponent } from "../../domain/project/model";
import type { PvoLanguageSource } from "../../domain/components/languageSource";
import { useCapture } from "../captureStore";

/** Ignore compiler results superseded by typing, Fields edits, reset, or history. */
export function acceptComponentCompilation(input: PvoComponent, compiled: CompiledPvoComponent): void {
  const state = useCapture.getState();
  const current = state.scenes.flatMap(scene => scene.components).find(item => item.id === input.id);
  if (!current?.code?.pvo || current.code !== input.code || current.fields !== input.fields || current.look !== input.look) return;
  const changes = compiledComponentChanges(current, current.code.pvo, compiled);
  if (JSON.stringify(changes) === JSON.stringify({ fields: current.fields, look: current.look, code: current.code })) return;
  state.updateComponent(current.id, changes, false);
}

/** Keep formatting as one undoable source edit without changing Fields or appearance. */
export function acceptFormattedComponentSource(input: PvoComponent, source: PvoLanguageSource, compiled: CompiledPvoComponent, recordHistory = true): boolean {
  const state = useCapture.getState();
  const current = state.components.find(item => item.id === input.id);
  if (state.selComp !== input.id || !current || current.code !== input.code
    || current.fields !== input.fields || current.look !== input.look) return false;
  state.updateComponent(current.id, { code: {
    ...current.code, custom: true, pvoLiteral: true, pvoTouched: false,
    pvo: { ...source }, pvoLastValid: { ...source },
    pvoCompiled: { structure: compiled.structure, rules: compiled.rules },
  } }, recordHistory);
  return true;
}
