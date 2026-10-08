const capabilities = ["model", "workspace", "hosting"];

/** Operator-supplied, account-scoped permission. Neither model output nor Resume grants spending. */
export function taskSpendingAllowed(env, ownerId, capability, now) {
  if (!capabilities.includes(capability) || !Number.isSafeInteger(now))
    return false;
  const encoded = env.ASSISTANT_TASK_SPENDING;
  if (typeof encoded !== "string" || encoded.length > 16384) return false;
  let grants;
  try {
    grants = JSON.parse(encoded);
  } catch {
    return false;
  }
  if (!Array.isArray(grants)) return false;
  const owners = new Set();
  for (const grant of grants) {
    if (
      !grant ||
      typeof grant !== "object" ||
      Array.isArray(grant) ||
      Object.keys(grant).length !== 3 ||
      typeof grant.ownerId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(grant.ownerId) ||
      owners.has(grant.ownerId) ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= 0 ||
      !Array.isArray(grant.capabilities) ||
      grant.capabilities.length === 0 ||
      new Set(grant.capabilities).size !== grant.capabilities.length ||
      grant.capabilities.some((value) => !capabilities.includes(value))
    )
      return false;
    owners.add(grant.ownerId);
  }
  return grants.some(
    (grant) =>
      grant.ownerId === ownerId &&
      now < grant.expiresAt &&
      grant.capabilities.includes(capability),
  );
}

export function taskSpendingCapability(task, builderStage) {
  if (task.stepId === "host") return "hosting";
  if (
    task.input.context.container?.mode === "test" ||
    task.stepId === "validate" ||
    (task.stepId === "build" && builderStage !== "model")
  )
    return "workspace";
  return "model";
}
