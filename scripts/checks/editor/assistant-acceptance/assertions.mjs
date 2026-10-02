import assert from "node:assert/strict";

export const scene = (project, id = "main") => {
  const value = project.scenes.find(item => item.id === id);
  assert(value, `Scene ${id} must exist`);
  return value;
};
export const layer = (items, id) => {
  const value = items.find(item => item.id === id);
  assert(value, `Layer ${id} must exist`);
  return value;
};
export function close(actual, expected, label, tolerance = 0.00001) {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual}`);
}
export function sameFootage(step) {
  for (const original of step.before.scenes) {
    assert.deepEqual(scene(step.after, original.id).clips, original.clips, `Original footage in ${original.id} must be preserved`);
  }
}
export function unchangedScene(step, id = "ending") {
  assert.deepEqual(scene(step.after, id), scene(step.before, id), `Unrequested scene ${id} must remain unchanged`);
}

/** Common acceptance invariants apply even when a scenario's semantic assertion fails. */
export function verifyWorkflow(step, definition) {
  const failures = [];
  const check = (name, action) => {
    try { action(); } catch (error) { failures.push({ assertion: name, message: error.message }); }
  };
  check("workflow completed", () => assert.equal(step.failure, null, JSON.stringify(step.failure)));
  check("private candidate", () => assert.deepEqual(step.atomicViolations, []));
  const changed = JSON.stringify(step.after) !== JSON.stringify(step.before);
  check("one Undo entry for complete edit", () => assert.equal(step.pastAfter - step.pastBefore, changed ? 1 : 0));
  check("at most one atomic commit", () => assert(step.commitCalls <= 1));
  if (changed) {
    check("one Undo restores exact project", () => assert.deepEqual(step.undone, step.before));
    check("Redo restores exact completed project", () => assert.deepEqual(step.redone, step.after));
  }
  if (step.failure) check("failure preserves project", () => assert.deepEqual(step.after, step.before));
  check("expected edit disposition", () => assert.equal(changed, definition.expect === "edit"));
  check("completed conversation contains no private receipts", () => {
    assert(!step.history.some(item => /Editor prepared these validated operations|These changes are not committed yet|Editor rejected these operations/.test(item.content)));
  });
  if (definition.expect === "blocked") {
    check("honest unsupported result", () => {
      assert.equal(step.turns.at(-1)?.response?.blocked, true, "Unsupported work must explicitly return blocked");
      assert(step.result?.message?.trim(), "Blocked result must explain the limitation");
    });
  }
  if (definition.maxObservations !== undefined) {
    check("bounded necessary observation count", () => assert(step.observations.length <= definition.maxObservations,
      `${step.observations.length} media inspections exceed expected maximum ${definition.maxObservations}`));
  }
  return failures;
}
