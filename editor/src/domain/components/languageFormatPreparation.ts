import type { CompiledPvoComponent } from "../../../../packages/pvo-language/index.js";
import { formatPvoSource } from "./languageFormatting";
import type { PvoLanguageSource } from "./languageSource";
import type { PvoComponent } from "../project/model";

/** Formatting is accepted only when the real compiler produces identical output. */
export async function preparePvoFormatting(
  type: PvoComponent["type"], source: PvoLanguageSource,
  compile: (type: PvoComponent["type"], source: PvoLanguageSource) => Promise<CompiledPvoComponent>, original?: CompiledPvoComponent,
  parts: readonly (keyof PvoLanguageSource)[] = ["structure", "style", "logic"],
): Promise<{ source: PvoLanguageSource; compiled: CompiledPvoComponent } | null> {
  const formattedParts = formatPvoSource(source);
  const formatted = { ...source };
  for (const part of parts) formatted[part] = formattedParts[part];
  if (formatted.structure === source.structure && formatted.style === source.style && formatted.logic === source.logic) return null;
  const before = original ?? await compile(type, source);
  // Unsupported formatting must leave the already-valid source usable.
  try {
    const after = await compile(type, formatted);
    return JSON.stringify(before) === JSON.stringify(after) ? { source: formatted, compiled: after } : null;
  } catch {
    return null;
  }
}
