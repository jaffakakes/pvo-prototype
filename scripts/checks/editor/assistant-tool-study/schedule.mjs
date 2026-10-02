import assert from "node:assert/strict";

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/** Adjacent matched pairs, alternating first arm by case and replicate. */
export function buildSchedule(cases, { replicates = 3, seed = 20261002 } = {}) {
  assert(Number.isInteger(replicates) && replicates >= 1 && replicates <= 20);
  assert(Number.isSafeInteger(seed));
  assert(cases.length > 0);
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  const random = randomGenerator(seed);
  const schedule = [];
  for (let replicate = 1; replicate <= replicates; replicate += 1) {
    const ordered = cases.map((definition, index) => ({ definition, index }));
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
    }
    for (const { definition, index } of ordered) {
      const first = (index + replicate - 1) % 2 === 0 ? "separate" : "coordinated";
      const arms = first === "separate" ? ["separate", "coordinated"] : ["coordinated", "separate"];
      const pairId = `${definition.id}-r${replicate}`;
      for (const [position, variant] of arms.entries()) schedule.push({
        ordinal: schedule.length + 1, caseId: definition.id, replicate, pairId,
        pairPosition: position + 1, variant, trialId: `${pairId}-${variant}`,
      });
    }
  }
  return schedule;
}
