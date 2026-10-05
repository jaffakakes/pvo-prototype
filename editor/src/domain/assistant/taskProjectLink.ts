import {
  parseTaskReference,
  type TaskReference,
} from "../../../../packages/pvo-assistant/tasks/index.js";

export type TaskProjectLinks = {
  localId: string;
  accounts: TaskReference[];
};

export const MAX_TASK_LINK_ACCOUNTS = 8;

/** Only locators are saved locally; task contents stay behind the account boundary. */
export function parseTaskProjectLinks(
  value: unknown,
  localId: string | null,
): TaskProjectLinks {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Saved task links are invalid.");
  const links = value as Record<string, unknown>;
  if (
    Object.keys(links).length !== 2 ||
    !Object.hasOwn(links, "localId") ||
    !Object.hasOwn(links, "accounts") ||
    !localId ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(localId) ||
    links.localId !== localId ||
    !Array.isArray(links.accounts) ||
    !links.accounts.length ||
    links.accounts.length > MAX_TASK_LINK_ACCOUNTS
  )
    throw new Error("Saved task links do not match this local project.");
  const accounts = Array.from(links.accounts, parseTaskReference);
  if (new Set(accounts.map((link) => link.ownerId)).size !== accounts.length)
    throw new Error("A local project can have only one task link per account.");
  return { localId, accounts };
}

export function taskLinksForProject(
  links: TaskProjectLinks | null,
  localId: string | null,
): TaskProjectLinks | null {
  return links?.localId === localId ? links : null;
}

export function ownedTaskReference(
  links: TaskProjectLinks | null,
  localId: string | null,
  ownerId: string | null,
): TaskReference | null {
  if (!ownerId) return null;
  const link = taskLinksForProject(links, localId)?.accounts.find(
    (item) => item.ownerId === ownerId,
  );
  return link ? { ...link } : null;
}

export function linkProjectTask(
  links: TaskProjectLinks | null,
  localId: string,
  reference: TaskReference,
): TaskProjectLinks {
  const incoming = parseTaskReference(reference);
  const accounts = taskLinksForProject(links, localId)?.accounts ?? [];
  const previous = accounts.find((item) => item.ownerId === incoming.ownerId);
  if (previous && previous.projectId !== incoming.projectId)
    throw new Error(
      "This account already linked the draft to a different server project.",
    );
  return parseTaskProjectLinks(
    {
      localId,
      accounts: [
        ...accounts.filter((item) => item.ownerId !== incoming.ownerId),
        incoming,
      ],
    },
    localId,
  );
}
