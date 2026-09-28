import type { ComponentType } from "../../domain/project/model";

export const TYPES: {
  type: ComponentType;
  name: string;
  sub: string;
}[] = [
  { type: "tooltip", name: "Add a note", sub: "A few words on your video" },
  { type: "card", name: "Show a message", sub: "Title, text and up to two buttons" },
  { type: "choice", name: "Let viewers choose", sub: "Two options, two possible paths" },
  { type: "form", name: "Ask for details", sub: "Answers viewers fill in and send" },
];
export const FIELD_KINDS = [
  { value: "name", label: "Name" }, { value: "email", label: "Email" }, { value: "phone", label: "Phone" },
  { value: "short", label: "Short text" }, { value: "yesno", label: "Yes / No" },
] as const;
export function nameOf(type: ComponentType) {
  return { tooltip: "Note", card: "Message", choice: "Choice", form: "Form" }[type];
}
