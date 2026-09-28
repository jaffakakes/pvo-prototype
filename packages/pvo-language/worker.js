import wasm from "./pkg/pvo_language_bg.wasm";
import { initSync, compile_component_json, action_allowed } from "./pkg/pvo_language.js";
import { readCompilationResult } from "./result.js";

export { PvoLanguageError } from "./result.js";

// Workers accept a bundled, precompiled Module; they cannot compile fetched bytes.
initSync({ module: wasm });

export async function compilePvoComponent(kind, source) {
  return readCompilationResult(compile_component_json(
    kind,
    source.structure,
    source.style,
    source.logic,
  ));
}

export function isPvoLanguageActionAllowed(kind, method) {
  return action_allowed(kind, method);
}
