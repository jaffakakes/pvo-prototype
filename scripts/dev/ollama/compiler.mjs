import { readFile } from "node:fs/promises";
import {
  initSync,
  compile_component_json,
} from "../../../packages/pvo-language/pkg/pvo_language.js";
import { readCompilationResult } from "../../../packages/pvo-language/result.js";

let initialization;

/** Node supplies bytes to the same Rust compiler used by the editor and Worker. */
export async function compileLocalComponent(kind, source) {
  initialization ??= readFile(
    new URL(
      "../../../packages/pvo-language/pkg/pvo_language_bg.wasm",
      import.meta.url,
    ),
  ).then((bytes) => initSync({ module: bytes }));
  await initialization;
  return readCompilationResult(
    compile_component_json(kind, source.structure, source.style, source.logic),
  );
}
