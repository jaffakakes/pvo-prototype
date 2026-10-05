import { formSubmissionOutcome } from "./forms";
/** Editable PVO source is retained alongside the last successfully compiled output. */
export type PvoLanguageSource = {
  structure: string;
  style: string;
  logic: string;
};
type FieldKind = "name" | "email" | "phone" | "short" | "yesno";
type Route = {
  kind: "continue";
} | {
  kind: "time";
  t: number;
} | {
  kind: "scene";
  sceneId: string;
};
type SourceOutcome = Route | {
  kind: "request";
  url: string;
  method: "GET" | "POST";
  body: string;
  onSuccess: Route;
  onError: Route | null;
};
type SourceFields = {
  text?: string;
  title?: string;
  body?: string;
  buttons?: readonly {
    label: string;
    outcome?: SourceOutcome;
  }[];
  prompt?: string;
  options?: readonly {
    label: string;
    outcome?: SourceOutcome;
  }[];
  fieldKinds?: readonly FieldKind[];
  formFields?: readonly { name: string; type: "text" | "number" | "yesno" }[];
  formSubmitMode?: "local" | "request" | "collect";
  heading?: string;
  destination?: string;
  successOutcome?: Route;
  failureOutcome?: Route | null;
  waitingLabel?: string;
  submitLabel?: string;
  outcome?: SourceOutcome;
};
type SourceComponent = {
  id?: string;
  type: "tooltip" | "card" | "choice" | "form";
  fields: SourceFields;
};
export function escapeStructureText(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}
/** Resolve no-code Field tokens before the Rust compiler parses Structure. */
export function substituteComponentTokens(source: string, fields: SourceFields): string {
  return source.replace(/\{\{([^{}]+)\}\}/g, (_match, raw: string) => {
    const key = raw.trim();
    const array = /^(options|buttons)\[(\d+)\]\.label$/.exec(key);
    if (array) {
      const item = fields[array[1] as "options" | "buttons"]?.[Number(array[2])];
      return escapeStructureText(item?.label ?? "");
    }
    const formField = /^formFields\[(\d+)\]\.name$/.exec(key);
    if (formField) return escapeStructureText(fields.formFields?.[Number(formField[1])]?.name ?? "");
    if (["text", "title", "body", "prompt", "submitLabel", "heading", "waitingLabel"].includes(key))
      return escapeStructureText(String(fields[key as keyof SourceFields] ?? ""));
    return "";
  });
}
function content(value: string | undefined, token: string, fallback: string): string {
  return value?.trim() ? token : fallback;
}
export function outcomeAction(outcome: SourceOutcome | undefined): string {
  if (outcome?.kind === "time")
    return `jump_to(${outcome.t})`;
  if (outcome?.kind === "scene")
    return `go_to_scene(${JSON.stringify(outcome.sceneId)})`;
  if (outcome?.kind === "request")
    return `request(${JSON.stringify({
      url: outcome.url,
      method: outcome.method,
      body: outcome.body,
      onSuccess: outcome.onSuccess,
      onError: outcome.onError,
    })})`;
  return "continue()";
}

function rule(event: string, outcome: SourceOutcome | undefined): string {
  return `${event} {\n  ${outcomeAction(outcome)};\n}`;
}

const STYLE_STARTERS = {
  tooltip: `tooltip {
  background: #FFD23E;
  color: #111;
  border-radius: 14px;
}
text {
  font-size: 13px;
  font-weight: 800;
}`,
  card: `card {
  background: #15151C;
  color: #F2F0E9;
  border-radius: 14px;
}
title {
  font-size: 19px;
  font-weight: 800;
}
body {
  font-size: 11px;
  font-weight: 700;
}`,
  button: `button {
  background: #FF2D78;
  color: #F2F0E9;
  border-radius: 9px;
}`,
  choice: `choice {
  background: transparent;
  border-width: 0;
  box-shadow: none;
  padding: 0;
  gap: 7px;
  color: #F2F0E9;
}
prompt {
  font-size: 19px;
  font-weight: 800;
  text-align: center;
}
option {
  background: #A78BFA;
  color: #111;
  border-radius: 9px;
}`,
  form: `form {
  background: #15151C;
  color: #F2F0E9;
  border-radius: 14px;
}
field {
  background: #1C1C24;
  color: #F2F0E9;
  border-radius: 7px;
}
submit {
  background: #FF2D78;
  color: #F2F0E9;
  border-radius: 9px;
}`,
} as const;

/** Generate tokens, not copied labels, so Fields can remain the no-code source until edited. */
export function generatePvoLanguageSource(component: SourceComponent): PvoLanguageSource {
  const { type, fields } = component;
  if (type === "tooltip") {
    return { structure: `<tooltip>\n  <text>${content(fields.text, "{{text}}", "Tap to learn more")}</text>\n</tooltip>`, style: STYLE_STARTERS.tooltip, logic: "" };
  }
  if (type === "card") {
    const buttons = (fields.buttons ?? []).slice(0, 2);
    const children = [
      `  <title>${content(fields.title, "{{title}}", "Title")}</title>`,
      `  <body>${content(fields.body, "{{body}}", "Text")}</body>`,
      ...buttons.map((button, index) => `  <button id="button${index}">${content(button.label, `{{buttons[${index}].label}}`, `Button ${index + 1}`)}</button>`),
    ];
    const logic = buttons.map((button, index) => rule(`on press(button${index})`, button.outcome)).join("\n\n");
    const style = buttons.length ? `${STYLE_STARTERS.card}\n${STYLE_STARTERS.button}` : STYLE_STARTERS.card;
    return { structure: `<card>\n${children.join("\n")}\n</card>`, style, logic };
  }
  if (type === "choice") {
    return {
      structure: `<choice>\n  <prompt>${content(fields.prompt, "{{prompt}}", "Which one?")}</prompt>\n  <option id="option0">${content(fields.options?.[0]?.label, "{{options[0].label}}", "Option A")}</option>\n  <option id="option1">${content(fields.options?.[1]?.label, "{{options[1].label}}", "Option B")}</option>\n</choice>`,
      style: STYLE_STARTERS.choice,
      logic: [0, 1].map(index => rule(`on choose(option${index})`, fields.options?.[index]?.outcome)).join("\n\n"),
    };
  }
  const fieldTags = fields.formFields
    ? fields.formFields.map((field, index) => `  <field name="field_${index + 1}" kind="${field.type === "text" ? "short" : field.type}" label="{{formFields[${index}].name}}" />`).join("\n")
    : (fields.fieldKinds ?? []).map((kind, index) => `  <field name="${kind}_${index}" kind="${kind}" />`).join("\n");
  const formOutcome = formSubmissionOutcome({ id: component.id ?? "component", fields: {
    formFields: fields.formFields?.map(field => ({ ...field })), fieldKinds: fields.fieldKinds ? [...fields.fieldKinds] : undefined,
    destination: fields.destination,
    formSubmitMode: fields.formSubmitMode, outcome: fields.outcome,
    successOutcome: fields.successOutcome, failureOutcome: fields.failureOutcome,
  } }) ?? undefined;
  return {
    structure: `<form>\n${fields.heading?.trim() ? "  <heading>{{heading}}</heading>\n" : ""}${fieldTags}${fieldTags ? "\n" : ""}  <submit${fields.waitingLabel?.trim() ? ' waiting="{{waitingLabel}}"' : ""}>${content(fields.submitLabel, "{{submitLabel}}", "Send")}</submit>\n</form>`,
    style: STYLE_STARTERS.form,
    logic: rule("on submit", formOutcome),
  };
}
