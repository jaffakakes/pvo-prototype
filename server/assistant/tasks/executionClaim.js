export const taskClaim = (task) =>
  task.claim ? { id: task.claim.id, generation: task.generation } : null;
export const transitionGuard = (task, now, claim = null) => ({
  ownerId: task.ownerId,
  expectedRevision: task.revision,
  now,
  claim,
});
export const hasCurrentClaim = (task, claimed, now) =>
  task?.state === "running" &&
  task.claim.id === claimed.claim.id &&
  task.generation === claimed.generation &&
  now < task.claim.expiresAt;
