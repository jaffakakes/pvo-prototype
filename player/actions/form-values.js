import {
  checkedFormValues,
  normalizedFormValue,
} from "../../packages/pvo-sdk/runtime/form-values.js";
/** Validate native and sandbox form messages against declared controls. */
export function formValuesForComponent(component, value, structure) {
  if (
    component.kind !== "form" ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("Those form values are not valid.");
  }
  const fields =
    structure?.type === "form" ? structure.fields : component.fields;
  if (!Array.isArray(fields))
    throw new Error("This form has no declared fields.");
  const entries = Object.entries(
    checkedFormValues(
      value,
      fields.map((field) => field.name),
    ),
  );
  const modernStructure =
    structure?.type === "form" &&
    (structure.heading !== undefined ||
      structure.waiting !== undefined ||
      structure.fields.some(
        (field) => field.label !== undefined || field.kind === "number",
      ));
  if (!component.restyle_capture?.form && !modernStructure)
    return Object.fromEntries(entries);
  const supplied = new Map(entries);
  return Object.fromEntries(
    fields.map((field) => {
      const name = field.name;
      return [name, normalizedFormValue(field, supplied.get(name))];
    }),
  );
}
