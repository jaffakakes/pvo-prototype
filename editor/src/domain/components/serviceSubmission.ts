import {
  matchesComponentServiceRequest,
  parseComponentServiceConnection,
  prepareServiceSubmissionTarget,
  resolveServiceSubmissionInput,
} from "../../../../packages/pvo-assistant/attachments/index.js";
import {
  ownedTaskReference,
  type TaskProjectLinks,
} from "../assistant/taskProjectLink";
import type { ComponentResponse, PvoComponent } from "../project/model";
import { componentLanguageModel } from "./languageEditing";

export type ComponentTestScope = {
  ownerId: string | null;
  localId: string | null;
  assistantTaskLinks: TaskProjectLinks | null;
  origin: string;
};

/** Select only the attached control, then freeze its validated input and private replay scope. */
function prepareComponentTestSelection(
  component: PvoComponent,
  response: ComponentResponse,
  scope: ComponentTestScope,
) {
  if (!component.serviceConnection) return null;
  const saved = parseComponentServiceConnection(component.serviceConnection);
  const model = componentLanguageModel(component);
  const structure = model.structure;
  let event: "submit" | "press" | "choose";
  let control: string | null | undefined;
  if (structure.type === "form") {
    event = "submit";
    control = response.index === 0 ? null : undefined;
  } else if (structure.type === "card") {
    event = "press";
    control = structure.buttons[response.index]?.id;
  } else if (structure.type === "choice") {
    event = "choose";
    control = structure.options[response.index]?.id;
  } else return null;
  if (event !== saved.connection.event || control !== saved.connection.target)
    return null;
  const rules = model.rules.filter(
    (rule) => rule.event === event && rule.target === control,
  );
  if (
    rules.length !== 1 ||
    rules[0].action.kind !== "request" ||
    response.outcome.kind !== "request" ||
    !matchesComponentServiceRequest(saved, rules[0].action) ||
    !matchesComponentServiceRequest(saved, response.outcome)
  ) {
    throw new Error(
      "This component's service request changed. Reconnect it before testing.",
    );
  }
  const reference = ownedTaskReference(
    scope.assistantTaskLinks,
    scope.localId,
    scope.ownerId,
  );
  if (
    !scope.localId ||
    !reference ||
    reference.projectId !== saved.receipt.identity.projectId ||
    scope.origin !== saved.origin
  ) {
    throw new Error(
      "This test connection belongs to another account, project or Restyle origin.",
    );
  }
  const target = prepareServiceSubmissionTarget(saved, {
    mode: "try",
    ownerId: reference.ownerId,
  });
  return {
    connection: saved,
    target,
    slot: JSON.stringify([
      "component-test",
      reference.ownerId,
      scope.localId,
      component.id,
      target.origin,
      target.serviceId,
      target.releaseId,
      target.operation.name,
      event,
      control,
    ]),
  };
}

export function prepareComponentTest(
  component: PvoComponent,
  response: ComponentResponse,
  scope: ComponentTestScope,
) {
  const prepared = prepareComponentTestSelection(component, response, scope);
  return prepared
    ? {
        ...prepared,
        input: resolveServiceSubmissionInput(
          prepared.connection,
          response.formValues ?? {},
        ),
      }
    : null;
}

/** Locate the same checked control before reading its saved input. */
export function prepareComponentTestRecovery(
  component: PvoComponent,
  scope: ComponentTestScope,
) {
  if (!component.serviceConnection) return null;
  const saved = parseComponentServiceConnection(component.serviceConnection);
  const model = componentLanguageModel(component);
  const rule = model.rules.find(
    (item) =>
      item.event === saved.connection.event &&
      item.target === saved.connection.target,
  );
  if (!rule)
    throw new Error(
      "The connected control changed. Reconnect it before testing.",
    );
  const structure = model.structure;
  let index = -1;
  if (structure.type === "form") index = 0;
  else if (structure.type === "card")
    index = structure.buttons.findIndex((item) => item.id === rule.target);
  else if (structure.type === "choice")
    index = structure.options.findIndex((item) => item.id === rule.target);
  const response: ComponentResponse = { index, outcome: rule.action };
  const prepared = prepareComponentTestSelection(component, response, scope);
  if (!prepared) throw new Error("The connected control is unavailable.");
  return { ...prepared, response };
}
