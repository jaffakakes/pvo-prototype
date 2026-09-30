import type { Outcome, PvoComponent } from "../project/model";
import { remapComponentTemplates, remapLanguageComponentTemplates } from "../scenes/languageReferences";

function remapRequest(outcome: Outcome, ids: ReadonlyMap<string, string>): Outcome {
  return outcome.kind === "request" ? {
    ...outcome,
    url: remapComponentTemplates(outcome.url, ids),
    body: remapComponentTemplates(outcome.body, ids),
  } : outcome;
}

function remapCode(code: PvoComponent["code"], ids: ReadonlyMap<string, string>, remapTooltipText: boolean): PvoComponent["code"] {
  return code && {
    ...code,
    pvo: code.pvo && {
      ...code.pvo,
      ...(remapTooltipText ? { structure: remapComponentTemplates(code.pvo.structure, ids) } : {}),
      logic: remapLanguageComponentTemplates(code.pvo.logic, ids),
    },
    pvoLastValid: code.pvoLastValid && {
      ...code.pvoLastValid,
      ...(remapTooltipText ? { structure: remapComponentTemplates(code.pvoLastValid.structure, ids) } : {}),
      logic: remapLanguageComponentTemplates(code.pvoLastValid.logic, ids),
    },
    pvoCompiled: code.pvoCompiled && {
      ...code.pvoCompiled,
      structure: remapTooltipText && code.pvoCompiled.structure.type === "tooltip" ? {
        ...code.pvoCompiled.structure,
        text: remapComponentTemplates(code.pvoCompiled.structure.text, ids),
      } : code.pvoCompiled.structure,
      rules: code.pvoCompiled.rules.map(rule => ({ ...rule, action: remapRequest(rule.action, ids) })),
    },
  };
}

/** Duplicated components read copied submissions in requests and reactive Note text. */
export function remapComponentReferences(component: PvoComponent, ids: ReadonlyMap<string, string>): PvoComponent {
  const fields = component.fields;
  const remapTooltipText = component.type === "tooltip";
  return {
    ...component,
    fields: {
      ...fields,
      ...(remapTooltipText && fields.text !== undefined
        ? { text: remapComponentTemplates(fields.text, ids) }
        : {}),
      destination: fields.destination && remapComponentTemplates(fields.destination, ids),
      outcome: fields.outcome && remapRequest(fields.outcome, ids),
      buttons: fields.buttons?.map(button => ({ ...button, outcome: button.outcome && remapRequest(button.outcome, ids) })),
      options: fields.options?.map(option => ({ ...option, outcome: remapRequest(option.outcome, ids) })),
    },
    code: remapCode(component.code, ids, remapTooltipText),
    archivedCode: remapCode(component.archivedCode, ids, remapTooltipText),
  };
}
