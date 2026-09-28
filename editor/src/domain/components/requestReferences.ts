import type { Outcome, PvoComponent } from "../project/model";
import { remapComponentTemplates, remapLanguageComponentTemplates } from "../scenes/languageReferences";

function remapRequest(outcome: Outcome, ids: ReadonlyMap<string, string>): Outcome {
  return outcome.kind === "request" ? {
    ...outcome,
    url: remapComponentTemplates(outcome.url, ids),
    body: remapComponentTemplates(outcome.body, ids),
  } : outcome;
}

function remapCode(code: PvoComponent["code"], ids: ReadonlyMap<string, string>): PvoComponent["code"] {
  return code && {
    ...code,
    pvo: code.pvo && { ...code.pvo, logic: remapLanguageComponentTemplates(code.pvo.logic, ids) },
    pvoLastValid: code.pvoLastValid && { ...code.pvoLastValid, logic: remapLanguageComponentTemplates(code.pvoLastValid.logic, ids) },
    pvoCompiled: code.pvoCompiled && {
      ...code.pvoCompiled,
      rules: code.pvoCompiled.rules.map(rule => ({ ...rule, action: remapRequest(rule.action, ids) })),
    },
  };
}

/** Duplicated components read their own submissions, including when saved code is restored. */
export function remapComponentRequests(component: PvoComponent, ids: ReadonlyMap<string, string>): PvoComponent {
  const fields = component.fields;
  return {
    ...component,
    fields: {
      ...fields,
      destination: fields.destination && remapComponentTemplates(fields.destination, ids),
      outcome: fields.outcome && remapRequest(fields.outcome, ids),
      buttons: fields.buttons?.map(button => ({ ...button, outcome: button.outcome && remapRequest(button.outcome, ids) })),
      options: fields.options?.map(option => ({ ...option, outcome: remapRequest(option.outcome, ids) })),
    },
    code: remapCode(component.code, ids),
    archivedCode: remapCode(component.archivedCode, ids),
  };
}
