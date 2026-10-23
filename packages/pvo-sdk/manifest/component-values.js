export const FORM_FIELD_LABELS = Object.freeze({
  name: "Name",
  email: "Email",
  phone: "Phone",
  short: "Short text",
  number: "Number",
  yesno: "Yes or no",
});

export function formFieldDefinition(field) {
  return {
    name: field.name,
    label: field.label ?? FORM_FIELD_LABELS[field.kind],
    type:
      field.kind === "email"
        ? "email"
        : field.kind === "number"
          ? "number"
          : field.kind === "yesno"
            ? "choice"
            : "text",
    ...(field.kind === "yesno"
      ? {
          options: [
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ],
        }
      : {}),
  };
}

/** Templates may vary request data and paths, but never the target host. */
export function requestHost(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter an absolute HTTP(S) request URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.host ||
    url.username ||
    url.password ||
    /[{}]/.test(url.host)
  )
    throw new Error("Enter an absolute HTTP(S) request URL with a fixed host.");
  return url.host.toLowerCase();
}

export function requestBody(source) {
  if (!source.trim()) return undefined;
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

export function actionForOutcome(outcome, componentId) {
  if (outcome?.kind === "time") return { type: "seek", time: outcome.t };
  if (outcome?.kind === "scene")
    return { type: "goto_scene", scene: outcome.sceneId };
  if (outcome?.kind === "request") {
    requestHost(outcome.url);
    return {
      type: "request",
      url: outcome.url.trim(),
      method: outcome.method,
      ...(outcome.method === "POST" && outcome.body.trim()
        ? { body: requestBody(outcome.body) }
        : {}),
      ...(componentId ? { into: `responses.${componentId}` } : {}),
      on_success: actionForOutcome(outcome.onSuccess),
      ...(outcome.onError
        ? { on_error: actionForOutcome(outcome.onError) }
        : {}),
    };
  }
  return { type: "custom", name: "restyle_continue" };
}
