import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { comparisonSandbox } from "../model-comparison/sandbox.mjs";
import { isolatedTaskEffects } from "./effects.mjs";
import {
  taskFixture,
  hosted,
  control,
  publicCall,
  inspect,
  expectStatus,
} from "../../../tests/service-actions/helpers.mjs";

const input = JSON.parse(await readFile(process.argv[2], "utf8"));
const selected = input.runs.find(
  (row) => row.arm === "candidate" && row.id === "B3" && row.repetition === 1,
);
assert.equal(
  selected?.status,
  "passed",
  "Preselected first waitlist artifact must pass before load testing; do not substitute a better trial.",
);
const directory = join(
  homedir(),
  ".codex/secure/restyle-capability",
  `pressure-load-${Date.now()}`,
);
await mkdir(directory, { recursive: true, mode: 0o700 });
const report = {
  protocol: "restyle-pressure-v1",
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  artifact: selected.artifact.identity,
  inputJournal: process.argv[2],
  resources: [],
  stages: [],
  status: "running",
};
let pending = Promise.resolve();
const save = () => {
  const body = JSON.stringify(report, null, 2);
  pending = pending.then(async () => {
    await writeFile(join(directory, "report.tmp"), body, { mode: 0o600 });
    await rename(join(directory, "report.tmp"), join(directory, "report.json"));
  });
  return pending;
};
await save();
console.log(`Journal: ${directory}/report.json`);
const sandbox = await comparisonSandbox(async (row) => {
  const prior = report.resources.findIndex((item) => item.name === row.name);
  if (prior < 0) report.resources.push(structuredClone(row));
  else report.resources[prior] = structuredClone(row);
  await save();
});
try {
  for (const count of [1, 5, 20]) {
    const resource = {
      kind: "local-worker",
      name: `load-${count}`,
      cleaned: false,
    };
    report.resources.push(resource);
    const stage = { count, outcomes: [], startedAt: new Date().toISOString() };
    report.stages.push(stage);
    await save();
    const f = await taskFixture({
      services: true,
      ...isolatedTaskEffects(sandbox),
      hostControl: async () => {
        await delay(75);
        return Response.json({});
      },
    });
    resource.storagePath = f.storagePath;
    await save();
    try {
      const service = await hosted(f, {
        checked: {
          artifact: selected.artifact,
          report: selected.reviews.at(-1).feedback.report,
        },
      });
      expectStatus(await control(f, service, "activate"), 200);
      const actions = Array.from({ length: count }, (_, i) => ({
        actionId: `viewer-${i}`,
        operation: "join",
        input: { name: `Viewer ${i}` },
      }));
      const start = performance.now();
      const responses = await Promise.all(
        actions.map(async (action) => {
          const begin = performance.now();
          const result = await publicCall(f, service, action);
          stage.outcomes.push({
            actionId: action.actionId,
            status: result.status,
            body: result.body,
            elapsedMs: performance.now() - begin,
          });
          await save();
          return result;
        }),
      );
      for (let index = 0; index < responses.length; index++) {
        if (responses[index].status === 429) {
          responses[index] = await publicCall(f, service, actions[index]);
          (stage.backpressureRetries ??= []).push({
            actionId: actions[index].actionId,
            status: responses[index].status,
          });
        }
        expectStatus(responses[index], 200);
        assert.deepEqual(Object.keys(responses[index].body).sort(), [
          "actionId",
          "result",
        ]);
      }
      stage.elapsedMs = performance.now() - start;
      const totals = responses.reduce((sum, response) => {
        const result = response.body.result;
        sum[result] = (sum[result] ?? 0) + 1;
        return sum;
      }, {});
      assert.equal(totals.accepted, 1);
      assert.equal(totals.waiting ?? 0, Math.min(count - 1, 8));
      assert.equal(totals.full ?? 0, Math.max(count - 9, 0));
      const before = await inspect(f, service);
      await f.restart();
      const replay = await Promise.all(
        Array.from({ length: 5 }, () => publicCall(f, service, actions[0])),
      );
      replay.forEach((reply) => {
        expectStatus(reply, 200);
        assert.deepEqual(reply.body, responses[0].body);
      });
      const after = await inspect(f, service);
      assert.deepEqual(
        after.data,
        before.data,
        "Repeated delivery must not change records.",
      );
      assert.deepEqual(after.receipts, before.receipts);
      const stored = JSON.parse(
        after.data.find((row) => row.namespace === "live").body,
      );
      assert.equal(stored.active.length, 1);
      assert.equal(
        new Set([...stored.active, ...stored.waiting]).size,
        Math.min(count, 9),
      );
      stage.totals = totals;
      stage.replayAfterRestart = true;
      stage.status = "passed";
    } finally {
      await f.close();
      resource.cleaned = true;
      await save();
    }
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.cleanupVerified = report.resources.every((item) => item.cleaned);
  report.completedAt = new Date().toISOString();
  await save();
  console.log(`Complete: ${report.status}; cleanup=${report.cleanupVerified}`);
}
