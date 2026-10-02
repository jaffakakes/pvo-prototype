import test from "node:test";
import assert from "node:assert/strict";
import { buildSchedule } from "./schedule.mjs";

const cases = Array.from({ length: 10 }, (_, index) => ({ id: `case-${index}` }));

test("each case gets three adjacent matched pairs and balanced arm order", () => {
  const schedule = buildSchedule(cases);
  assert.equal(schedule.length, 60);
  assert.equal(new Set(schedule.map(item => item.trialId)).size, 60);
  let separateFirst = 0;
  for (let index = 0; index < schedule.length; index += 2) {
    const [left, right] = schedule.slice(index, index + 2);
    assert.equal(left.pairId, right.pairId);
    assert.equal(left.caseId, right.caseId);
    assert.equal(left.replicate, right.replicate);
    assert.notEqual(left.variant, right.variant);
    if (left.variant === "separate") separateFirst += 1;
  }
  assert.equal(separateFirst, 15);
  for (const definition of cases) for (const variant of ["separate", "coordinated"])
    assert.equal(schedule.filter(item => item.caseId === definition.id && item.variant === variant).length, 3);
});

test("schedule is reproducible and seed changes case order without changing matching", () => {
  assert.deepEqual(buildSchedule(cases, { seed: 42 }), buildSchedule(cases, { seed: 42 }));
  assert.notDeepEqual(buildSchedule(cases, { seed: 42 }), buildSchedule(cases, { seed: 43 }));
});
