import type { ComponentFields, FormField, Outcome, PvoComponent } from "../project/model";
import { requestHost } from "./actions";

const LEGACY_LABELS = { name: "Name", email: "Email", phone: "Phone", short: "Short text", yesno: "Yes / no" };
export type FormControl = {
  name: string;
  label: string;
  type: FormField["type"];
  inputType: "text" | "number" | "email" | "tel";
};

/** A Form is a request only when its current action explicitly says so. */
export function formUsesRequest(fields: ComponentFields): boolean {
  if (fields.formSubmitMode) return fields.formSubmitMode === "request";
  return fields.outcome?.kind === "request";
}

export function getFormFields(fields: ComponentFields): FormField[] {
  return fields.formFields ?? (fields.fieldKinds ?? []).map(kind => ({
    name: LEGACY_LABELS[kind], type: kind === "yesno" ? "yesno" : "text",
  }));
}

/** Turn only the untouched Form starter into a message prompt. Custom forms keep their wording and controls. */
export function collectReplyStartingFields(fields: ComponentFields): ComponentFields {
  const rows = fields.formFields;
  const starter = fields.heading === "Get early access"
    && fields.submitLabel === "Continue"
    && fields.formSubmitMode === "local"
    && !fields.destination
    && fields.outcome?.kind === "continue"
    && rows?.length === 2
    && rows[0].name === "Name" && rows[0].type === "text"
    && rows[1].name === "Email" && rows[1].type === "text";
  return starter ? {
    ...fields,
    heading: "Send me a message",
    formFields: [{ name: "Your message", type: "text" }],
    submitLabel: "Send",
  } : fields;
}

/** Project an explicitly authored Form action into the visual editor fields. */
export function toVisualFormFields(fields: ComponentFields): ComponentFields {
  if (fields.formFields) return fields;
  const request = fields.outcome?.kind === "request" ? fields.outcome : null;
  return {
    ...fields,
    formFields: getFormFields(fields),
    formSubmitMode: fields.formSubmitMode ?? (formUsesRequest(fields) ? "request" : "local"),
    destination: fields.destination ?? request?.url ?? "",
    successOutcome: fields.successOutcome ?? request?.onSuccess ?? (fields.outcome?.kind !== "request" ? fields.outcome : undefined) ?? { kind: "continue" },
    failureOutcome: fields.failureOutcome === undefined ? request?.onError ?? null : fields.failureOutcome,
    waitingLabel: fields.waitingLabel ?? "Sending…",
  };
}

/** Stable safe input names keep display wording out of runtime state paths. */
export function formFieldControls(fields: ComponentFields): FormControl[] {
  if (fields.formFields) return fields.formFields.map((field, index) => ({
    name: `field_${index + 1}`, label: field.name, type: field.type,
    inputType: field.type === "number" ? "number" : "text",
  }));
  return (fields.fieldKinds ?? []).map((kind, index) => ({
    name: `${kind}_${index}`, label: LEGACY_LABELS[kind], type: kind === "yesno" ? "yesno" : "text",
    inputType: kind === "email" ? "email" : kind === "phone" ? "tel" : "text",
  }));
}

export function validateFormFields(fields: readonly FormField[]): void {
  if (fields.length < 1 || fields.length > 5) throw new Error("Use between one and five fields.");
  for (const field of fields) {
    if (!field.name.trim() || field.name.length > 24) throw new Error("Give each field a name of up to 24 characters.");
    if (!["text", "number", "yesno"].includes(field.type)) throw new Error("Choose Text, A number, or Yes / no for each field.");
  }
}

/** Destination setup is explicit; requests remain subject to the SDK host allowlist. */
export function setFormDestination(fields: ComponentFields, rawUrl: string): ComponentFields {
  const destination = rawUrl.trim();
  if (destination) requestHost(destination);
  return { ...fields, formSubmitMode: "request", destination };
}

function formAnswerBody(componentId: string, controls: readonly Pick<FormControl, "name" | "label" | "type">[]): string {
  if (!/^[A-Za-z0-9_-]+$/.test(componentId)) throw new Error("Form ID contains unsupported characters.");
  return JSON.stringify({ answers: controls.map(field => ({
    name: field.label, type: field.type, value: `{state.form.${componentId}.${field.name}}`,
  })) });
}

export function formSubmissionOutcome(
  component: Pick<PvoComponent, "id" | "fields">,
  controls: readonly Pick<FormControl, "name" | "label" | "type">[] = formFieldControls(component.fields),
): Outcome | null {
  const { fields } = component;
  if (fields.formSubmitMode === "local")
    return fields.outcome?.kind !== "request" ? fields.outcome ?? fields.successOutcome ?? { kind: "continue" }
      : fields.successOutcome ?? { kind: "continue" };
  if (fields.formSubmitMode === "collect") {
    if (!fields.destination?.trim()) return null;
    requestHost(fields.destination);
    return {
      kind: "request", url: fields.destination.trim(), method: "POST",
      body: formAnswerBody(component.id, controls),
      onSuccess: fields.successOutcome ?? { kind: "continue" },
      onError: fields.failureOutcome ?? null,
    };
  }
  const authoredRequest = fields.outcome?.kind === "request" ? fields.outcome : null;
  if (!authoredRequest && fields.formSubmitMode !== "request")
    return fields.outcome ?? { kind: "continue" };
  const destination = fields.destination ?? authoredRequest?.url;
  if (!destination?.trim()) return null;
  requestHost(destination);
  if (authoredRequest && fields.destination === undefined && fields.successOutcome === undefined && fields.failureOutcome === undefined)
    return authoredRequest;
  if (authoredRequest) return {
    ...authoredRequest, url: destination.trim(),
    onSuccess: fields.successOutcome ?? authoredRequest.onSuccess,
    onError: fields.failureOutcome === undefined ? authoredRequest.onError : fields.failureOutcome,
  };
  return {
    kind: "request", url: destination.trim(), method: "POST",
    body: formAnswerBody(component.id, controls),
    onSuccess: fields.successOutcome ?? { kind: "continue" },
    onError: fields.failureOutcome ?? null,
  };
}

export function formValuesForSubmission(fields: ComponentFields, values: Record<string, string>): Record<string, string | number | boolean> {
  return Object.fromEntries(formFieldControls(fields).map(field => {
    const value = values[field.name] ?? (field.type === "yesno" ? "no" : "");
    if (value.length > 1024) throw new Error(`${field.label} is too long.`);
    if (field.type === "number" && value.trim()) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`Enter a number for ${field.label}.`);
      return [field.name, number];
    }
    if (fields.formFields && field.type === "yesno") return [field.name, value === "yes" || value === "true"];
    return [field.name, value];
  }));
}
