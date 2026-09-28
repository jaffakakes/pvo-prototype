import type { PvoComponent } from "../project/model";
import { fieldsShownFor } from "./fields";
import { componentLanguageSource } from "./languageCompilation";
import { componentLook, createLook } from "./look";
import { toVisualFormFields } from "./forms";
import type { PvoLanguageSource } from "./languageSource";

/** Source ownership does not lock visual controls; only an unfinished draft does. */
export function isVisualEditingBlocked(component: PvoComponent): boolean {
  const code = component.code;
  return Boolean(code && (!code.pvo || code.pvoTouched || (code.custom && !code.pvoCompiled)));
}

export function beginPvoEdit(component: PvoComponent, part: keyof PvoLanguageSource, value: string): Partial<PvoComponent> {
  const source = componentLanguageSource(component);
  const code = component.code;
  return { code: {
    ...code, custom: true, pvoLiteral: true, pvoTouched: true,
    pvoLastValid: code?.pvoLastValid ?? (code?.pvoTouched ? undefined : { ...source }),
    pvo: { ...source, [part]: value },
  } };
}

export function restoreLastValidPvo(component: PvoComponent): Partial<PvoComponent> | null {
  const source = component.code?.pvoLastValid;
  if (!source) return null;
  return { code: { ...component.code!, pvo: { ...source }, pvoTouched: true, pvoLiteral: true } };
}

export function isCodeOwned(component: PvoComponent): boolean {
  return Boolean(component.code?.custom || component.code?.pvoTouched || (component.code && !component.code.pvo));
}

export function takeOverWithCode(component: PvoComponent, restoreSaved = false): Partial<PvoComponent> {
  const saved = restoreSaved ? component.archivedCode : undefined;
  return {
    look: { ...componentLook(component), preset: "custom" },
    code: saved ? structuredClone({ ...saved, custom: true }) : {
      custom: true,
      pvoLiteral: true,
      pvoTouched: true,
      pvo: componentLanguageSource(component),
    },
  };
}

/** Reset requires an explicit UI confirmation; saved source remains recoverable. */
export function returnToVisualEditing(component: PvoComponent): Partial<PvoComponent> {
  const shown = fieldsShownFor(component);
  const fields = component.type === "form" ? toVisualFormFields(shown) : shown;
  const count = component.type === "choice" ? 2 : component.type === "form" ? 1 : fields.buttons?.length ?? 0;
  return {
    fields,
    look: createLook("bold", count),
    archivedCode: component.code ? structuredClone(component.code) : component.archivedCode,
    code: undefined,
  };
}
