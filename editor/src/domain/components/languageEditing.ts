import type { PvoLanguageRule, PvoLanguageStructure } from "../../../../packages/pvo-language/index.js";
import type { ComponentFields, Outcome, PvoComponent } from "../project/model";
import { fieldsShownFor } from "./fields";
import { formSubmissionOutcome, getFormFields } from "./forms";
import { resolveLanguageSource } from "./languageCompilation";
import { componentLookLanguage } from "./lookLanguage";
import { escapeStructureText, generatePvoLanguageSource, outcomeAction, substituteComponentTokens } from "./languageSource";

type Control = { label: string; outcome?: Outcome };
type NamedControl = { id: string; label: string };
type FormField = Extract<PvoLanguageStructure, { type: "form" }>["fields"][number];

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function freshIdentifier(prefix: string, used: Set<string>): string {
  let index = 0;
  while (used.has(`${prefix}${index}`)) index += 1;
  const id = `${prefix}${index}`;
  used.add(id);
  return id;
}

function controlIndexes<T>(previous: readonly T[], stored: readonly T[], next: readonly T[]): number[] {
  const used = new Set<number>();
  const indexes = next.map(control => {
    const index = previous.findIndex((item, at) => !used.has(at) && (item === control || stored[at] === control));
    if (index >= 0) used.add(index);
    return index;
  });
  for (let at = 0; at < next.length; at += 1) {
    if (indexes[at] >= 0) continue;
    const index = previous.findIndex((item, candidate) => !used.has(candidate) && equal(item, next[at]));
    if (index >= 0) {
      indexes[at] = index;
      used.add(index);
    }
  }
  // A label/outcome edit replaces its row object but retains the control's place.
  if (previous.length === next.length) {
    for (let at = 0; at < next.length; at += 1) {
      if (indexes[at] >= 0) continue;
      const index = used.has(at) ? previous.findIndex((_, candidate) => !used.has(candidate)) : at;
      indexes[at] = index;
      used.add(index);
    }
  }
  return indexes;
}

function editControls(
  controls: readonly NamedControl[], previous: readonly Control[], stored: readonly Control[],
  next: readonly Control[], prefix: string,
): NamedControl[] {
  const indexes = controlIndexes(previous, stored, next);
  const used = new Set(controls.map(control => control.id));
  return next.map((control, index) => ({
    id: controls[indexes[index]]?.id ?? freshIdentifier(prefix, used),
    label: control.label,
  }));
}

function editFormFields(previous: readonly FormField[], kinds: NonNullable<ComponentFields["fieldKinds"]>): FormField[] {
  const usedIndexes = new Set<number>();
  const usedNames = new Set(previous.map(field => field.name));
  return kinds.map(kind => {
    const index = previous.findIndex((field, at) => field.kind === kind && !usedIndexes.has(at));
    if (index >= 0) {
      usedIndexes.add(index);
      return previous[index];
    }
    return { kind, name: freshIdentifier(`${kind}_`, usedNames) };
  });
}

function editVisualFormFields(component: PvoComponent, source: readonly FormField[], previous: ComponentFields, next: ComponentFields): FormField[] {
  const before = getFormFields(previous);
  const after = getFormFields(next);
  const indexes = controlIndexes(before, getFormFields(component.fields), after);
  const usedNames = new Set(source.map(field => field.name));
  return after.map((field, index) => {
    const at = indexes[index];
    const original = source[at];
    // Phone and email remain their authored input kind when a label is edited.
    const kind = original && before[at]?.type === field.type ? original.kind : field.type === "text" ? "short" : field.type;
    return {
      name: original?.name ?? freshIdentifier("field_", usedNames), kind,
      ...(original && before[at]?.name === field.name && original.label === undefined ? {} : { label: field.name }),
    };
  });
}

function initialStructure(component: PvoComponent, fields: ComponentFields): PvoLanguageStructure {
  const compiled = component.code?.pvoCompiled?.structure;
  if (compiled?.type === component.type) return compiled;
  if (component.type === "tooltip") return { type: "tooltip", text: fields.text ?? "" };
  if (component.type === "card") return {
    type: "card", title: fields.title ?? null, body: fields.body ?? null,
    buttons: (fields.buttons ?? []).map((button, index) => ({ id: `button${index}`, label: button.label })),
  };
  if (component.type === "choice") return {
    type: "choice", prompt: fields.prompt ?? "",
    options: (fields.options ?? []).map((option, index) => ({ id: `option${index}`, label: option.label })),
  };
  return {
    type: "form", submit: fields.submitLabel ?? "",
    ...(fields.heading?.trim() ? { heading: fields.heading } : {}),
    ...(fields.waitingLabel?.trim() ? { waiting: fields.waitingLabel } : {}),
    fields: fields.formFields
      ? fields.formFields.map((field, index) => ({ kind: field.type === "text" ? "short" : field.type, name: `field_${index + 1}`, label: field.name }))
      : (fields.fieldKinds ?? []).map((kind, index) => ({ kind, name: `${kind}_${index}` })),
  };
}

function editStructure(component: PvoComponent, previous: ComponentFields, next: ComponentFields): PvoLanguageStructure {
  const structure = initialStructure(component, previous);
  if (structure.type === "tooltip") return { ...structure, text: next.text ?? "" };
  if (structure.type === "card") return {
    ...structure,
    title: structure.title === null && previous.title === next.title ? null : next.title ?? null,
    body: structure.body === null && previous.body === next.body ? null : next.body ?? null,
    buttons: editControls(structure.buttons, previous.buttons ?? [], component.fields.buttons ?? [], next.buttons ?? [], "button"),
  };
  if (structure.type === "choice") return {
    ...structure, prompt: next.prompt ?? "",
    options: editControls(structure.options, previous.options ?? [], component.fields.options ?? [], next.options ?? [], "option"),
  };
  return {
    ...structure, submit: next.submitLabel ?? "",
    ...(next.heading === undefined ? {} : { heading: next.heading || undefined }),
    ...(next.waitingLabel === undefined ? {} : { waiting: next.waitingLabel || undefined }),
    fields: next.formFields
      ? editVisualFormFields(component, structure.fields, previous, next)
      : equal(previous.fieldKinds, next.fieldKinds) ? structure.fields : editFormFields(structure.fields, next.fieldKinds ?? []),
  };
}

function formRequest(structure: Extract<PvoLanguageStructure, { type: "form" }>, fields: ComponentFields, componentId: string) {
  const rows = getFormFields(fields);
  return formSubmissionOutcome({ id: componentId, fields: { ...fields, outcome: undefined } }, structure.fields.map((field, index) => ({
    name: field.name, label: rows[index]?.name ?? field.label ?? field.name,
    type: field.kind === "number" ? "number" : field.kind === "yesno" ? "yesno" : "text",
  })));
}

function rulesFor(structure: PvoLanguageStructure, fields: ComponentFields, componentId: string,
  previous?: { structure: PvoLanguageStructure; fields: ComponentFields }): PvoLanguageRule[] {
  if (structure.type === "tooltip") return [];
  if (structure.type === "form") {
    if (fields.formSubmitMode === "local")
      return [{ event: "submit", target: null, action: formSubmissionOutcome({ id: componentId, fields })! }];
    const original = fields.outcome;
    if (original?.kind === "request" && fields.destination === "")
      return [{ event: "submit", target: null, action: { kind: "continue" } }];
    const generated = fields.formFields || fields.formSubmitMode === "request" ? formRequest(structure, fields, componentId) : null;
    const priorGenerated = previous?.structure.type === "form"
      ? formRequest(previous.structure, previous.fields, componentId) : null;
    // Only the editor's own answer payload follows renamed/removed rows. Authored payloads stay intact.
    const body = original?.kind === "request" && priorGenerated?.kind === "request" && generated?.kind === "request"
      && original.body === priorGenerated.body ? generated.body : original?.kind === "request" ? original.body : "";
    const action = original?.kind === "request" ? {
      ...original, body, url: fields.destination ?? original.url,
      onSuccess: fields.successOutcome ?? original.onSuccess,
      onError: fields.failureOutcome === undefined ? original.onError : fields.failureOutcome,
    } : generated ?? original ?? { kind: "continue" as const };
    return [{ event: "submit", target: null, action }];
  }
  const controls = structure.type === "card" ? structure.buttons : structure.options;
  const values = structure.type === "card" ? fields.buttons : fields.options;
  return controls.map((control, index) => ({
    event: structure.type === "card" ? "press" : "choose",
    target: control.id,
    action: values?.[index]?.outcome ?? { kind: "continue" },
  }));
}

function structureSource(structure: PvoLanguageStructure): string {
  const text = (tag: string, value: string, id?: string) =>
    `  <${tag}${id ? ` id="${id}"` : ""}>${escapeStructureText(value)}</${tag}>`;
  let children: string[];
  if (structure.type === "tooltip") children = [text("text", structure.text)];
  else if (structure.type === "card") children = [
    ...(structure.title === null ? [] : [text("title", structure.title)]),
    ...(structure.body === null ? [] : [text("body", structure.body)]),
    ...structure.buttons.map(button => text("button", button.label, button.id)),
  ];
  else if (structure.type === "choice") children = [
    text("prompt", structure.prompt),
    ...structure.options.map(option => text("option", option.label, option.id)),
  ];
  else children = [
    ...(structure.heading ? [text("heading", structure.heading)] : []),
    ...structure.fields.map(field => `  <field name="${field.name}" kind="${field.kind}"${field.label !== undefined ? ` label="${escapeStructureText(field.label)}"` : ""} />`),
    `  <submit${structure.waiting ? ` waiting="${escapeStructureText(structure.waiting)}"` : ""}>${escapeStructureText(structure.submit)}</submit>`,
  ];
  return `<${structure.type}>\n${children.join("\n")}\n</${structure.type}>`;
}

function logicSource(rules: readonly PvoLanguageRule[]): string {
  return rules.map(rule => {
    const event = rule.target === null ? "on submit" : `on ${rule.event}(${rule.target})`;
    return `${event} {\n  ${outcomeAction(rule.action)};\n}`;
  }).join("\n\n");
}

/** The current validated model, or the same model used to generate visual source. */
export function componentLanguageModel(component: PvoComponent) {
  if (component.code?.custom && component.code.pvoCompiled) return component.code.pvoCompiled;
  const structure = initialStructure({ ...component, code: undefined }, component.fields);
  return { structure, rules: rulesFor(structure, component.fields, component.id) };
}

function equalRules(previous: readonly PvoLanguageRule[], next: readonly PvoLanguageRule[]): boolean {
  return previous.length === next.length && next.every(rule => previous.some(candidate =>
    candidate.event === rule.event && candidate.target === rule.target && equal(candidate.action, rule.action)));
}

function identifiers(structure: PvoLanguageStructure): string[] {
  if (structure.type === "card") return structure.buttons.map(button => button.id);
  if (structure.type === "choice") return structure.options.map(option => option.id);
  if (structure.type === "form") return structure.fields.map(field => field.name);
  return [];
}

function removeDeletedControlStyles(style: string, before: PvoLanguageStructure, after: PvoLanguageStructure): string {
  const retained = new Set(identifiers(after));
  const removed = new Set(identifiers(before).filter(id => !retained.has(id)));
  if (!removed.size) return style;
  // Valid PVO Style contains only flat rules; declarations cannot contain braces.
  return style.replace(/#([A-Za-z0-9_-]+)\s*\{[^{}]*\}/g,
    (rule, id: string) => removed.has(id) ? "" : rule);
}

function validateRetainedFieldReferences(componentId: string, before: PvoLanguageStructure, after: PvoLanguageStructure, rules: readonly PvoLanguageRule[]): void {
  if (before.type !== "form" || after.type !== "form") return;
  const retained = new Set(after.fields.map(field => field.name));
  for (const removed of before.fields.filter(field => !retained.has(field.name))) {
    const reference = `{state.form.${componentId}.${removed.name}}`;
    if (rules.some(rule => rule.action.kind === "request" && (rule.action.body.includes(reference) || rule.action.url.includes(reference))))
      throw new Error("This field is used by the submit action. Change the action before removing it.");
  }
}

/** Apply a complete Fields edit to its corresponding source without replacing unrelated sections. */
export function editComponentFields(component: PvoComponent, nextFields: ComponentFields): Pick<PvoComponent, "fields" | "code"> {
  if (component.code?.pvoTouched || (component.code?.custom && !component.code.pvoCompiled))
    return { fields: component.fields, code: component.code };
  const fields = { ...component.fields, ...nextFields };
  const code = component.code;
  if (!code?.pvo) return { fields, code };

  if (!code.custom) {
    const generated = generatePvoLanguageSource({ id: component.id, type: component.type, fields });
    const structure = initialStructure({ ...component, code: undefined }, fields);
    const source = {
      ...generated, structure: substituteComponentTokens(generated.structure, fields),
      ...(component.look ? { style: componentLookLanguage({ ...component, fields }) } : {}),
    };
    return {
      fields,
      code: {
        ...code,
        pvo: source,
        pvoLiteral: true, pvoTouched: false, pvoCompiled: { structure, rules: rulesFor(structure, fields, component.id) },
      },
    };
  }

  const previous = fieldsShownFor(component);
  const before = editStructure(component, previous, previous);
  const structure = editStructure(component, previous, fields);
  const rules = rulesFor(structure, fields, component.id, { structure: before, fields: previous });
  validateRetainedFieldReferences(component.id, before, structure, rules);
  if (structure.type === "form" && fields.formFields) fields.outcome = rules[0].action;
  const source = resolveLanguageSource(component, code.pvo);
  const previousRules = code.pvoCompiled?.rules ?? rulesFor(before, previous, component.id);
  const editedSource = {
    structure: equal(before, structure) ? source.structure : structureSource(structure),
    style: removeDeletedControlStyles(source.style, before, structure),
    logic: equalRules(previousRules, rules) ? source.logic : logicSource(rules),
  };
  return {
    fields,
    code: {
      ...code,
      pvo: editedSource,
      pvoLiteral: true, pvoTouched: false, pvoCompiled: { structure, rules },
    },
  };
}
