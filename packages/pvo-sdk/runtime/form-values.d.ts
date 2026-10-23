export const FORM_VALUE_LIMIT: 1024;
export const FORM_FIELD_LIMIT: 20;
export type FormValue = string | number | boolean;
export function formValueError(name: string, value: unknown): string | null;
export function checkedFormValues(
  value: unknown,
  declaredNames?: Iterable<string>,
): Record<string, FormValue>;
export function normalizedFormValue(
  field: { name: string; label?: string; type?: string; kind?: string },
  supplied: FormValue | undefined,
  typedBoolean?: boolean,
): FormValue;
