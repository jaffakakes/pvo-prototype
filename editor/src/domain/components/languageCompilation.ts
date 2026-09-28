import type { CompiledPvoComponent } from "../../../../packages/pvo-language/index.js";
import type { PvoComponent } from "../project/model";
import { fieldsFromCompiled } from "./fields";
import { componentLookLanguage } from "./lookLanguage";
import { componentLook } from "./look";
import { generatePvoLanguageSource, substituteComponentTokens, type PvoLanguageSource } from "./languageSource";

/** Unedited starters follow Fields; a direct draft must be validated even before its first success. */
export function componentLanguageSource(component: PvoComponent): PvoLanguageSource {
  const code = component.code;
  if (code?.pvo && (code.custom || code.pvoTouched)) return resolveLanguageSource(component, code.pvo);
  const generated = generatePvoLanguageSource(component);
  return {
    ...generated,
    ...(component.look ? { style: componentLookLanguage(component) } : {}),
    structure: substituteComponentTokens(generated.structure, component.fields),
  };
}

export function resolveLanguageSource(component: PvoComponent, source: PvoLanguageSource): PvoLanguageSource {
  return component.code?.pvoLiteral ? source : {
    ...source,
    structure: substituteComponentTokens(source.structure, component.fields),
  };
}

/** The editor's Choice UI and export contract both require exactly two options. */
export function validateEditableLanguage(compiled: CompiledPvoComponent): void {
  if (compiled.structure.type === "choice" && compiled.structure.options.length !== 2)
    throw new Error("Choice: use exactly two options in this editor.");
}

/** Commit source and its Fields projection together, without feeding tokens back into themselves. */
export function compiledComponentChanges(
  component: PvoComponent,
  source: PvoLanguageSource,
  compiled: Pick<CompiledPvoComponent, "structure" | "rules">,
): Pick<PvoComponent, "fields" | "look" | "code"> {
  const code = component.code!;
  const custom = code.custom || code.pvoTouched === true;
  const syncFields = custom && (code.pvoTouched || !code.pvoLiteral);
  const acceptedSource = custom ? resolveLanguageSource(component, source) : source;
  const accepted: PvoComponent = { ...component, code: {
    ...code, custom, pvoTouched: false, pvoLiteral: custom || code.pvoLiteral,
    pvo: acceptedSource, pvoLastValid: { ...acceptedSource },
    pvoCompiled: { structure: compiled.structure, rules: compiled.rules },
  } };
  return {
    // A Fields edit may contain trailing whitespace while the user is typing.
    // Compilation normalizes text; only direct Advanced edits replace the input values.
    fields: syncFields ? fieldsFromCompiled(compiled) : component.fields,
    look: custom ? componentLook(accepted) : component.look,
    code: accepted.code,
  };
}
