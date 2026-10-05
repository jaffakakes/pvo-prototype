import {
  parseTaskApplication,
  type TaskApplication,
} from "../../../../packages/pvo-assistant/results/index.js";
import {
  parseTaskReference,
  parseTaskInput,
  replayTaskCreation,
  type TaskInput,
  type TaskRecord,
  type TaskReference,
} from "../../../../packages/pvo-assistant/tasks/index.js";

export type TaskProjectLinks = {
  localId: string;
  accounts: TaskReference[];
  pending?: PendingTaskCreation[];
  applied?: TaskApplication[];
};

export type PendingTaskCreation = { ownerId: string; input: TaskInput };

export const MAX_TASK_LINK_ACCOUNTS = 8;

/** Retain the original submission until its receipt arrives; completed links contain IDs only. */
export function parseTaskProjectLinks(
  value: unknown,
  localId: string | null,
): TaskProjectLinks {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Saved task links are invalid.");
  const links = value as Record<string, unknown>;
  if (
    Object.keys(links).some(
      (key) => !["localId", "accounts", "pending", "applied"].includes(key),
    ) ||
    !Object.hasOwn(links, "localId") ||
    !Object.hasOwn(links, "accounts") ||
    !localId ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(localId) ||
    links.localId !== localId ||
    !Array.isArray(links.accounts) ||
    links.accounts.length > MAX_TASK_LINK_ACCOUNTS
  )
    throw new Error("Saved task links do not match this local project.");
  const accounts = Array.from(links.accounts, parseTaskReference);
  if (new Set(accounts.map((link) => link.ownerId)).size !== accounts.length)
    throw new Error("A local project can have only one task link per account.");
  let pending: PendingTaskCreation[] | undefined;
  if (Object.hasOwn(links, "pending")) {
    if (
      !Array.isArray(links.pending) ||
      !links.pending.length ||
      links.pending.length > MAX_TASK_LINK_ACCOUNTS
    )
      throw new Error("Pending task submissions are invalid.");
    pending = Array.from(links.pending, (item: unknown) => {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).length !== 2
      )
        throw new Error("Pending task submission is invalid.");
      const value = item as PendingTaskCreation;
      const input = parseTaskInput(value.input);
      // Use the shared ID contract for the account and its intended project.
      const reference = parseTaskReference({
        ownerId: value.ownerId,
        projectId: input.projectId,
        taskId: input.operationId,
      });
      const linked = accounts.find(
        (entry) => entry.ownerId === reference.ownerId,
      );
      if (linked && linked.projectId !== input.projectId)
        throw new Error("Pending task belongs to a different server project.");
      return { ownerId: reference.ownerId, input };
    });
    if (new Set(pending.map((item) => item.ownerId)).size !== pending.length)
      throw new Error("Only one pending submission per account is allowed.");
  }
  const owners = new Set(
    [...accounts, ...(pending ?? [])].map((item) => item.ownerId),
  );
  if (!owners.size || owners.size > MAX_TASK_LINK_ACCOUNTS)
    throw new Error("Saved task account limit exceeded.");
  let applied: TaskApplication[] | undefined;
  if (Object.hasOwn(links, "applied")) {
    if (
      !Array.isArray(links.applied) ||
      !links.applied.length ||
      links.applied.length > 64
    )
      throw new Error("Saved result application limit exceeded.");
    applied = Array.from(links.applied, parseTaskApplication);
    if (
      new Set(applied.map((item) => `${item.ownerId}:${item.taskId}`)).size !==
      applied.length
    )
      throw new Error("A saved result can only be applied once.");
    for (const item of applied)
      if (
        !accounts.some(
          (account) =>
            account.ownerId === item.ownerId &&
            account.projectId === item.projectId,
        )
      )
        throw new Error(
          "An applied result belongs to a different account or project.",
        );
  }
  return {
    localId,
    accounts,
    ...(pending ? { pending } : {}),
    ...(applied ? { applied } : {}),
  };
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
  const current = taskLinksForProject(links, localId);
  const accounts = current?.accounts ?? [];
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
      ...(current?.pending ? { pending: current.pending } : {}),
      ...(current?.applied ? { applied: current.applied } : {}),
    },
    localId,
  );
}

export function ownedPendingTask(
  links: TaskProjectLinks | null,
  localId: string | null,
  ownerId: string | null,
): PendingTaskCreation | null {
  const pending = taskLinksForProject(links, localId)?.pending?.find(
    (item) => item.ownerId === ownerId,
  );
  return pending ? structuredClone(pending) : null;
}

export function stageProjectTask(
  links: TaskProjectLinks | null,
  localId: string,
  pending: PendingTaskCreation,
): TaskProjectLinks {
  const current = taskLinksForProject(links, localId);
  if (ownedPendingTask(current, localId, pending.ownerId))
    throw new Error(
      "Recover the pending task before starting another request.",
    );
  return parseTaskProjectLinks(
    {
      localId,
      accounts: current?.accounts ?? [],
      pending: [...(current?.pending ?? []), pending],
      ...(current?.applied ? { applied: current.applied } : {}),
    },
    localId,
  );
}

export function completeProjectTask(
  links: TaskProjectLinks,
  ownerId: string,
  task: TaskRecord,
): TaskProjectLinks {
  const pending = ownedPendingTask(links, links.localId, ownerId);
  if (!pending) throw new Error("This task has no pending submission.");
  replayTaskCreation(task, pending.input, {
    ownerId,
    inputDigest: task.creationDigest,
  });
  const next = linkProjectTask(links, links.localId, {
    ownerId,
    projectId: task.input.projectId,
    taskId: task.id,
  });
  const remaining = next.pending!.filter((item) => item.ownerId !== ownerId);
  return {
    localId: next.localId,
    accounts: next.accounts,
    ...(next.applied ? { applied: next.applied } : {}),
    ...(remaining.length ? { pending: remaining } : {}),
  };
}

/** Only the explicit clear-expired-request command calls this after a server 410. */
export function discardPendingProjectTask(
  links: TaskProjectLinks,
  ownerId: string,
  operationId: string,
): TaskProjectLinks | null {
  const current = ownedPendingTask(links, links.localId, ownerId);
  if (!current || current.input.operationId !== operationId)
    throw new Error("The pending request changed before it could be cleared.");
  const pending = links.pending!.filter((item) => item.ownerId !== ownerId);
  if (!pending.length && !links.accounts.length) return null;
  return parseTaskProjectLinks(
    {
      localId: links.localId,
      accounts: links.accounts,
      ...(links.applied ? { applied: links.applied } : {}),
      ...(pending.length ? { pending } : {}),
    },
    links.localId,
  );
}

/** Old receipts stay outside Undo; reaching the bound must never evict replay protection. */
export function recordTaskApplication(
  links: TaskProjectLinks,
  value: TaskApplication,
): TaskProjectLinks {
  const receipt = parseTaskApplication(value);
  const reference = ownedTaskReference(links, links.localId, receipt.ownerId);
  if (
    !reference ||
    reference.taskId !== receipt.taskId ||
    reference.projectId !== receipt.projectId
  )
    throw new Error("This result is no longer the draft's current saved task.");
  const previous = links.applied?.find(
    (item) =>
      item.ownerId === receipt.ownerId && item.taskId === receipt.taskId,
  );
  if (previous) {
    if (
      previous.projectId !== receipt.projectId ||
      previous.artifact.id !== receipt.artifact.id ||
      previous.artifact.sha256 !== receipt.artifact.sha256 ||
      previous.artifact.bytes !== receipt.artifact.bytes
    )
      throw new Error("This task's result does not match its applied receipt.");
    return links;
  }
  return parseTaskProjectLinks(
    { ...links, applied: [...(links.applied ?? []), receipt] },
    links.localId,
  );
}
