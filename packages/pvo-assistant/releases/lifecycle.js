import { parseServicePublication } from "./publication.js";
import { sameServiceIdentity } from "./identity.js";
import {
  SERVICE_CATALOG_LIMITS as limits,
  parseOwnedRelease,
  parseOwnedService,
} from "./catalog.js";

/** Decide an immutable publication intent from a bounded owner catalog snapshot. */
export function planOwnedPublication(task, value, snapshot, now) {
  const publication = parseServicePublication(value),
    { identity, artifact } = publication;
  if (
    identity.ownerId !== task.ownerId ||
    identity.projectId !== task.input.projectId ||
    identity.taskId !== task.id ||
    identity.expiresAt !== task.deadlineAt
  )
    throw new Error("Service intent does not belong to its saved task.");
  let { service, prior, services, releases } = snapshot;
  if (
    service &&
    (service.identity.ownerId !== identity.ownerId ||
      service.identity.projectId !== identity.projectId)
  )
    throw new Error("Service ownership conflicts.");
  if (prior) {
    if (!sameServiceIdentity(prior.identity, identity))
      throw new Error("Release contents are immutable.");
    return { service, release: prior };
  }
  const all = services,
    day = Math.floor(now / 86400000) * 86400000;
  if (
    !service &&
    (all.length >= limits.identities ||
      all.filter((item) => item.state !== "deleted").length >= limits.active ||
      all.filter((item) => item.createdAt >= day).length >= limits.daily)
  )
    throw Object.assign(new Error("Your service limit has been reached."), {
      code: "budget_exceeded",
    });
  if (service?.state === "deleted" || releases.length >= limits.releases)
    throw Object.assign(
      new Error("This service cannot accept another release."),
      { code: "budget_exceeded" },
    );
  if (!service) {
    service = {
      identity: {
        serviceId: identity.serviceId,
        ownerId: identity.ownerId,
        projectId: identity.projectId,
      },
      description: artifact.agreement.description,
      state: "inactive",
      hostRevision: null,
      createdAt: now,
      updatedAt: now,
    };
  }
  const release = {
    identity,
    runtime: artifact.package.runtime,
    permissions: artifact.agreement.operations.map(
      ({ name, audience, access }) => ({ name, audience, access }),
    ),
    state: "pending",
    createdAt: now,
    updatedAt: now,
  };
  return {
    service: parseOwnedService(service),
    release: parseOwnedRelease(release),
  };
}

export function observeOwnedRelease(release, identity, state, now) {
  if (!release || !sameServiceIdentity(release.identity, identity))
    throw new Error("Unknown owned release observation.");
  if (
    state === "missing" ||
    release.state === "deleted" ||
    (release.state === "retained" && state === "available")
  )
    return release;
  if (!["available", "retained", "deleted"].includes(state))
    throw new Error("Unsupported release observation.");
  return parseOwnedRelease({
    ...release,
    state: state === "available" ? "inactive" : state,
    updatedAt: now,
  });
}
export function expireOwnedService(service, releases, now) {
  if (
    service.state !== "inactive" ||
    !releases.length ||
    !releases.every(
      (item) => item.state === "deleted" && item.identity.expiresAt <= now,
    )
  )
    return service;
  return parseOwnedService({ ...service, state: "deleted", updatedAt: now });
}
