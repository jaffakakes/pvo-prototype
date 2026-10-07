import {
  parseTaskInput,
  parseTaskReference,
  type TaskInput,
  type TaskReference,
} from "../../../../packages/pvo-assistant/tasks/index.js";
export type DraftTaskLink = {
  input: TaskInput;
  reference: TaskReference | null;
};
const key = (ownerId: string, serviceId: string) =>
  `restyle:container-task:${ownerId}:${serviceId}`;
export function readDraftTaskLink(
  ownerId: string,
  serviceId: string,
): DraftTaskLink | null {
  const encoded = localStorage.getItem(key(ownerId, serviceId));
  if (!encoded) return null;
  const value = JSON.parse(encoded) as DraftTaskLink;
  const input = parseTaskInput(value.input);
  const reference =
    value.reference === null ? null : parseTaskReference(value.reference);
  if (
    !("container" in input.context) ||
    input.context.container.serviceId !== serviceId ||
    (reference &&
      (reference.ownerId !== ownerId ||
        reference.projectId !== input.projectId))
  )
    throw new Error(
      "This saved editing task belongs to another Container or account.",
    );
  return { input, reference };
}
export function saveDraftTaskLink(
  ownerId: string,
  serviceId: string,
  value: DraftTaskLink | null,
) {
  if (value)
    localStorage.setItem(key(ownerId, serviceId), JSON.stringify(value));
  else localStorage.removeItem(key(ownerId, serviceId));
}
