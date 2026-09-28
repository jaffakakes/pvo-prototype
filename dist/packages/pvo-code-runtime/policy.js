export const MAX_HTML = 20_000;
export const MAX_CSS = 20_000;
export const MAX_JS = 20_000;
export const MAX_FIELDS = 8_000;
export const MAX_ACTION_BYTES = 8_000;
export const MAX_RESPONSE_BYTES = 64_000;
export const MAX_ACTIONS_PER_SECOND = 20;
export const START_TIMEOUT_MS = 3_000;
export const EVENT_TIMEOUT_MS = 1_500;
export const REQUEST_TIMEOUT_MS = 20_000;

export const METHODS = new Set([
  "pick",
  "goToScene",
  "jumpTo",
  "resume",
  "track",
  "submit",
  "request",
]);
export const RENDER_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

export function boundedSource(options) {
  const html = String(options.html ?? "");
  const css = String(options.css ?? "");
  const js = String(options.js ?? "");
  const fields =
    options.fields && typeof options.fields === "object" ? options.fields : {};
  let fieldsSize;
  try {
    fieldsSize = JSON.stringify(fields).length;
  } catch {
    throw new Error("Component fields are invalid.");
  }
  if (
    html.length > MAX_HTML ||
    css.length > MAX_CSS ||
    js.length > MAX_JS ||
    fieldsSize > MAX_FIELDS
  ) {
    throw new Error("Component code is too large.");
  }
  return { html, css, js, fields };
}
