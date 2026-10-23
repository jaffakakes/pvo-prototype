import {
  checkedFormValues,
  formValueError,
  FORM_VALUE_LIMIT,
} from "../pvo-sdk/runtime/form-values.js";

const ownedErrors = new WeakSet();

export function limitRenderedFormValues(root) {
  for (const input of root.querySelectorAll("input,textarea"))
    if (input.maxLength < 0 || input.maxLength > FORM_VALUE_LIMIT)
      input.maxLength = FORM_VALUE_LIMIT;
}

/** Preserve entered values and let native validation explain invalid answers. */
export function readRenderedFormValues(form) {
  const controls = Array.from(form.elements ?? []);
  for (const control of controls)
    if (ownedErrors.has(control)) {
      control.setCustomValidity("");
      ownedErrors.delete(control);
    }
  const values = Object.fromEntries(new FormData(form));
  try {
    return checkedFormValues(values);
  } catch (error) {
    const control =
      controls.find((item) => formValueError(item.name, values[item.name])) ??
      controls.find((item) => typeof item.setCustomValidity === "function");
    if (control?.setCustomValidity) {
      control.setCustomValidity(error.message);
      ownedErrors.add(control);
    }
    form.reportValidity?.();
    return null;
  }
}
