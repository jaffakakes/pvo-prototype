import type { CompiledPvoComponent } from "../../../../packages/pvo-language/index.js";
import type { ComponentFields, Outcome, PvoComponent } from "../project/model";

export function choiceOptions(fields: ComponentFields) {
  return [0, 1].map(index => fields.options?.[index] ?? { label: `Option ${String.fromCharCode(65 + index)}`, outcome: { kind: "continue" } as Outcome });
}
export function fieldsShownFor(component: PvoComponent): ComponentFields {
  const compiled = component.code?.custom ? component.code.pvoCompiled : null;
  if (!compiled || (component.code?.pvoLiteral && component.code.pvoTouched === false))
    return component.fields;
  const projected = fieldsFromCompiled(compiled);
  // Preserve control identity for no-code removal/reordering after synchronization.
  return JSON.stringify(projected) === JSON.stringify(component.fields) ? component.fields : projected;
}

export function fieldsFromCompiled(compiled: Pick<CompiledPvoComponent, "structure" | "rules">): ComponentFields {
  const { structure, rules } = compiled;
  const route = (id: string | null): Outcome => rules.find(rule => rule.target === id)?.action ?? { kind: "continue" };
  if (structure.type === "tooltip")
    return { text: structure.text };
  if (structure.type === "card")
    return {
      title: structure.title ?? "", body: structure.body ?? "",
      buttons: structure.buttons.map(button => ({ label: button.label, outcome: route(button.id) })),
    };
  if (structure.type === "choice")
    return {
      prompt: structure.prompt,
      options: structure.options.map(option => ({ label: option.label, outcome: route(option.id) })),
    };
  const outcome = route(null);
  if (structure.heading !== undefined || structure.waiting !== undefined || structure.fields.some(field => field.label !== undefined || field.kind === "number")) {
    const labels = { name: "Name", email: "Email", phone: "Phone", short: "Short text", number: "Number", yesno: "Yes / no" };
    return {
      heading: structure.heading ?? "", submitLabel: structure.submit, waitingLabel: structure.waiting ?? "Sending…",
      formFields: structure.fields.map(field => ({ name: field.label ?? labels[field.kind], type: field.kind === "number" ? "number" : field.kind === "yesno" ? "yesno" : "text" })),
      destination: outcome.kind === "request" ? outcome.url : "",
      formSubmitMode: outcome.kind === "request" ? "request" : "local",
      successOutcome: outcome.kind === "request" ? outcome.onSuccess : outcome,
      failureOutcome: outcome.kind === "request" ? outcome.onError : null,
      outcome,
    };
  }
  return {
    fieldKinds: structure.fields.map(field => field.kind === "number" ? "short" : field.kind),
    submitLabel: structure.submit,
    formSubmitMode: outcome.kind === "request" ? "request" : "local",
    outcome,
  };
}
