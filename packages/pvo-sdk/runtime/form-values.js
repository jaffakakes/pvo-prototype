export const FORM_VALUE_LIMIT = 1024;
export const FORM_FIELD_LIMIT = 20;

export function formValueError(name, value) {
  if (
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) ||
    ["constructor", "prototype", "__proto__"].includes(name) ||
    !["string", "number", "boolean"].includes(typeof value)
  )
    return "Those form values are not valid.";
  if (String(value).length > FORM_VALUE_LIMIT)
    return `Each answer must be ${FORM_VALUE_LIMIT} characters or fewer.`;
  if (typeof value === "number" && !Number.isFinite(value))
    return "Enter a finite number.";
  return null;
}

/** Validate without truncating or dropping answers at a format boundary. */
export function checkedFormValues(value, declaredNames) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Those form values are not valid.");
  const entries = Object.entries(value);
  if (entries.length > FORM_FIELD_LIMIT)
    throw new Error("This form has too many answers.");
  const declared = declaredNames && new Set(declaredNames);
  for (const [name, entry] of entries) {
    const error = formValueError(name, entry);
    if (error) throw new Error(error);
    if (declared && !declared.has(name))
      throw new Error(
        "Those form values are not valid. That field is not declared.",
      );
  }
  return Object.fromEntries(entries);
}

export function normalizedFormValue(field, supplied, typedBoolean = true) {
  const value =
    supplied ??
    (field.type === "choice" || field.kind === "yesno" ? false : "");
  const error = formValueError(field.name, value);
  if (error) throw new Error(error);
  if (
    (field.type === "number" || field.kind === "number") &&
    String(value).trim()
  ) {
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new Error(`Enter a number for ${field.label || field.name}.`);
    return number;
  }
  if (
    typedBoolean &&
    [field.type, field.kind].some(
      (kind) => kind === "choice" || kind === "yesno",
    )
  )
    return (
      value === true || value === "yes" || value === "true" || value === "on"
    );
  return value;
}
