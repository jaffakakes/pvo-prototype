import initialize, { action_allowed, compile_component_json } from "./pkg/pvo_language.js";
import { readCompilationResult } from "./result.js";

export { PvoLanguageError } from "./result.js";

let initialization;

/** One Rust/WASM compiler is shared by the editor and player. */
export async function compilePvoComponent(kind, source) {
  initialization ??= initialize().catch((error) => {
    initialization = undefined;
    throw new Error(`PVO language compiler could not start: ${String(error?.message || error)}`);
  });
  await initialization;
  return readCompilationResult(compile_component_json(
    kind,
    source.structure,
    source.style,
    source.logic,
  ));
}

/** Call only after compilePvoComponent has initialized the Rust compiler. */
export function isPvoLanguageActionAllowed(kind, method) {
  if (!initialization) return false;
  return action_allowed(kind, method);
}
