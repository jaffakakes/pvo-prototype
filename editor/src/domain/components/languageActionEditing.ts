import type { ComponentFields, Outcome, OutcomeTarget, PvoComponent } from "../project/model";
import { editComponentFields } from "./languageEditing";
import { fieldsShownFor } from "./fields";
import { escapeStructureText, outcomeAction } from "./languageSource";

/** Locate one top-level event body without interpreting arbitrary draft code. */
function eventBody(source: string, event: string, target: string | null): [number, number] | null {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let opening = -1;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (depth === 0) {
      const header = /^on\s+(submit|press|choose)\s*(?:\(\s*([A-Za-z0-9_-]+)\s*\))?\s*\{/.exec(source.slice(index));
      if (header && header[1] === event && (header[2] ?? null) === target) {
        opening = index + header[0].length - 1;
        index = opening;
        depth = 1;
        continue;
      }
    }
    if (character === "{") depth++;
    else if (character === "}") {
      depth--;
      if (depth === 0 && opening >= 0) return [opening + 1, index];
      if (depth < 0) return null;
    }
  }
  return null;
}

/** Actions stay editable beside an invalid Style/Structure draft, without replacing that draft. */
export function editComponentAction(
  component: PvoComponent, fields: ComponentFields, target: OutcomeTarget, outcome: Outcome,
): Pick<PvoComponent, "fields" | "code"> | null {
  const code = component.code;
  if (!code?.pvoTouched && !(code?.custom && !code.pvoCompiled)) return editComponentFields(component, fields);
  if (!code?.pvo) return null;
  const structure = code.pvoCompiled?.structure;
  const index = target.index ?? 0;
  const event = target.kind === "form" ? "submit" : target.kind === "option" ? "choose" : "press";
  const id = target.kind === "form" ? null
    : structure?.type === "choice" ? structure.options[index]?.id
      : structure?.type === "card" ? structure.buttons[index]?.id
        : `${target.kind}${index}`;
  if (id === undefined) return null;
  const body = eventBody(code.pvo.logic, event, id);
  if (!body) return null;
  const accepted = code.pvoLastValid && code.pvoCompiled ? editComponentFields({
    ...component, code: { ...code, pvo: code.pvoLastValid, pvoTouched: false },
  }, fields) : null;
  return {
    fields,
    code: {
      ...code,
      pvoLastValid: accepted?.code?.pvo ?? code.pvoLastValid,
      pvo: { ...code.pvo, logic: `${code.pvo.logic.slice(0, body[0])}\n  ${outcomeAction(outcome)};\n${code.pvo.logic.slice(body[1])}` },
      pvoCompiled: code.pvoCompiled && {
        ...code.pvoCompiled,
        rules: code.pvoCompiled.rules.map(rule => rule.event === event && rule.target === id ? { ...rule, action: outcome } : rule),
      },
    },
  };
}

/** Edit only a well-formed submit opening tag, even beside an invalid draft section. */
export function editComponentWaitingLabel(component: PvoComponent, label: string): Pick<PvoComponent, "fields" | "code"> | null {
  if (component.type !== "form") return null;
  const fields = { ...fieldsShownFor(component), waitingLabel: label };
  const code = component.code;
  if (!code?.pvoTouched && !(code?.custom && !code.pvoCompiled)) return editComponentFields(component, fields);
  if (!code?.pvo) return null;
  const source = code.pvo.structure;
  const starts = [...source.matchAll(/<submit(?=[\s>])/g)];
  if (starts.length !== 1) return null;
  const start = starts[0].index;
  let quote = "";
  let end = -1;
  for (let index = start + 7; index < source.length; index++) {
    const character = source[index];
    if (character === "<") return null;
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") { end = index + 1; break; }
  }
  if (end < 0) return null;
  const opening = source.slice(start, end);
  if (!/^<submit(?:\s+waiting\s*=\s*(?:"[^"<]*"|'[^'<]*'))?\s*>$/.test(opening)) return null;
  const replacement = label.trim() ? `<submit waiting="${escapeStructureText(label)}">` : "<submit>";
  const accepted = code.pvoLastValid && code.pvoCompiled ? editComponentFields({
    ...component, code: { ...code, pvo: code.pvoLastValid, pvoTouched: false },
  }, fields) : null;
  return {
    fields,
    code: {
      ...code,
      pvoLastValid: accepted?.code?.pvo ?? code.pvoLastValid,
      pvo: { ...code.pvo, structure: source.slice(0, start) + replacement + source.slice(end) },
      pvoCompiled: code.pvoCompiled && {
        ...code.pvoCompiled,
        structure: code.pvoCompiled.structure.type === "form"
          ? { ...code.pvoCompiled.structure, waiting: label.trim() ? label : undefined }
          : code.pvoCompiled.structure,
      },
    },
  };
}
