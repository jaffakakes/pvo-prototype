import type { PvoLanguageStructure } from "../../../../../packages/pvo-language/index.js";
import {
  patchLookStyle,
  readLookStyle,
  type StyleChange,
} from "../../components/languageLookStyle";

/** A native style operation changes named declarations while retaining every unrelated rule. */
export function patchAssistantStyle(
  current: string,
  patch: string,
  structure: PvoLanguageStructure,
): string {
  const existing = readLookStyle(current, structure);
  const requested = readLookStyle(patch, structure);
  if (!existing || !requested || !requested.length)
    throw new Error("Provide supported component style declarations.");
  const changes = new Map<string, StyleChange>();
  for (const rule of requested)
    for (const declaration of rule.declarations) {
      const change = {
        selector: rule.selector,
        property: declaration.property,
        value: declaration.value,
      };
      changes.set(`${change.selector}:${change.property}`, change);
    }
  return patchLookStyle(current, existing, [...changes.values()]);
}
