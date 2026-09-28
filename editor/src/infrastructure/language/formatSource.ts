import { compilePvoComponent, type CompiledPvoComponent } from "../../../../packages/pvo-language/index.js";
import { formatPvoSource } from "../../domain/components/languageFormatting";
import type { PvoLanguageSource } from "../../domain/components/languageSource";
import type { PvoComponent } from "../../domain/project/model";

/** Formatting is accepted only when the real compiler produces identical output. */
export async function preparePvoFormatting(
  type: PvoComponent["type"], source: PvoLanguageSource,
  compile = compilePvoComponent, original?: CompiledPvoComponent,
): Promise<{ source: PvoLanguageSource; compiled: CompiledPvoComponent } | null> {
  const formatted = formatPvoSource(source);
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
