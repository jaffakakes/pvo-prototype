import {
  parsePublicServiceConnection,
  publicServiceSubmissionTarget,
  matchesPublicServiceRequest,
  resolvePublicServiceSubmissionInput,
  validateServiceBindingFields,
} from "../../packages/pvo-assistant/attachments/index.js";
import { canonicalJson } from "../../packages/pvo-assistant/services/json.js";
import { componentAction } from "../actions/selection.js";

function nativeStructure(component) {
  if (component.restyle_capture?.code)
    throw new Error("Compile the connected component before opening it.");
  if (component.kind === "card")
    return {
      type: "card",
      buttons: (component.actions ?? []).map((_, index) => ({
        id: `button${index}`,
      })),
    };
  if (component.kind === "choice")
    return {
      type: "choice",
      options: (component.options ?? []).map((_, index) => ({
        id: `option${index}`,
      })),
    };
  if (component.kind === "form" && component.restyle_capture?.form)
    return {
      type: "form",
      heading: component.title ?? "",
      fields: (component.fields ?? []).map((field) => ({
        name: field.name,
        kind:
          field.type === "number"
            ? "number"
            : field.type === "choice"
              ? "yesno"
              : "short",
      })),
    };
  throw new Error("The connected component has no supported controls.");
}

/** Admit viewer data against the actual executable control, after language compilation. */
export function admitPlayerServiceConnection(component, language) {
  const value = component.restyle_capture?.service_connection;
  if (value === undefined) return null;
  const connection = parsePublicServiceConnection(value);
  const structure = language?.structure ?? nativeStructure(component);
  let index = -1,
    event;
  if (structure.type === "form") {
    event = "submit";
    if (connection.target === null) index = 0;
  } else if (structure.type === "card") {
    event = "press";
    index = structure.buttons.findIndex(
      (button) => button.id === connection.target,
    );
  } else if (structure.type === "choice") {
    event = "choose";
    index = structure.options.findIndex(
      (option) => option.id === connection.target,
    );
  }
  const action = componentAction(component, index);
  if (
    component.kind !== structure.type ||
    index < 0 ||
    connection.event !== event ||
    action?.type !== "request" ||
    !matchesPublicServiceRequest(connection, {
      url: action.url,
      method: action.method,
      body: canonicalJson(action.body),
    })
  )
    throw new Error(
      `Component ${component.id} does not match its service connection.`,
    );
  validateServiceBindingFields(
    connection.input,
    connection.operation.input,
    structure,
  );
  return {
    connection,
    index,
    target: publicServiceSubmissionTarget(connection),
  };
}

/** Hash executable content too: changing an asset behind the same path cannot recover another draft's action. */
export async function readPlayerServiceConnections(
  manifest,
  languages,
  digest = (bytes) => crypto.subtle.digest("SHA-256", bytes),
) {
  const admitted = new Map();
  for (const component of manifest.components ?? []) {
    const entry = admitPlayerServiceConnection(
      component,
      languages.get(component.id),
    );
    if (entry) admitted.set(component.id, entry);
  }
  if (!admitted.size) return admitted;
  const bytes = new TextEncoder().encode(
    canonicalJson({ manifest, languages: [...languages] }),
  );
  const hash = [...new Uint8Array(await digest(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  for (const [componentId, entry] of admitted)
    entry.slot = JSON.stringify([
      "player-service",
      hash,
      componentId,
      entry.connection.event,
      entry.connection.target,
    ]);
  return admitted;
}

/** Recheck synchronously at dispatch and snapshot form values before opening browser storage. */
export function preparePlayerServiceSubmission(
  entry,
  component,
  language,
  index,
  fields,
) {
  if (!entry || index !== entry.index) return null;
  const current = admitPlayerServiceConnection(component, language);
  if (
    !current ||
    canonicalJson(current.connection) !== canonicalJson(entry.connection) ||
    current.index !== entry.index
  )
    throw new Error("This service connection changed. Reopen the video.");
  return {
    ...entry,
    input: resolvePublicServiceSubmissionInput(entry.connection, fields ?? {}),
  };
}
