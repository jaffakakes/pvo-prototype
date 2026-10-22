import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";

const [latestPath, supplementaryPath] = process.argv.slice(2);
if (!latestPath)
  throw new Error(
    "Supply the completed latest journal and optional preliminary journal.",
  );
const segments = [];
async function readSegment(path) {
  const bytes = await readFile(path);
  const value = JSON.parse(bytes);
  if (value.predecessor) await readSegment(value.predecessor);
  segments.push({
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value,
  });
}
await readSegment(latestPath);
const latest = segments.at(-1).value;
assert.ok(
  latest.completedAt,
  "Do not summarize an unfinished evaluation as complete.",
);
const grades = JSON.parse(
  await readFile("docs/engineering/restyle-capability/grades.json", "utf8"),
);
const selected = new Map();
const excluded = [];
const usage = (rows) => {
  const attempts = rows.flatMap((row) => row.attempts);
  return {
    calls: attempts.length,
    inputTokens: attempts.reduce((n, a) => n + (a.usage?.input ?? 0), 0),
    outputTokens: attempts.reduce((n, a) => n + (a.usage?.output ?? 0), 0),
    knownEstimatedUsd: attempts.reduce(
      (n, a) => n + (a.usage?.estimatedUsd ?? 0),
      0,
    ),
    unknownUsageAttempts: attempts.filter((a) => !a.usage).length,
  };
};
function project(row, journal) {
  const key = `${row.id}.${row.repetition}`;
  const grade = grades.grades[key];
  return {
    key,
    journal,
    family: row.family,
    status: row.status,
    grade,
    seconds: row.elapsedMs == null ? null : row.elapsedMs / 1000,
    usage: usage([row]),
    validationRepairs: row.validationRepairs ?? 0,
    toolFailures: row.toolFailures ?? 0,
    finalRevision: row.source?.revision ?? null,
    finalSourceDigest: row.source?.digest ?? null,
    decisions: (row.decisions ?? []).map((x) => x.kind),
    reviews: (row.reviews ?? []).map((x) => ({
      feedback: x.feedback,
      holdouts: x.holdouts,
      generatedExitCode: x.generated?.exitCode ?? null,
    })),
    output: row.output ?? null,
    failure: row.failure
      ? {
          message: row.failure.message ?? row.failure,
          code: row.failure.code ?? null,
          validation: row.failure.feedback?.message ?? null,
        }
      : null,
    calls: row.attempts.map((a) => ({
      sequence: a.sequence,
      promptDigest: a.promptDigest,
      model: a.returnedModel ?? null,
      outcome: a.outcome ?? null,
      status: a.status ?? null,
      finishReason: a.response?.choices?.[0]?.finish_reason ?? null,
      elapsedMs: a.elapsedMs ?? null,
      usage: a.usage ?? null,
    })),
  };
}
for (const { path, value } of segments) {
  assert.equal(
    value.matrixDigest,
    latest.matrixDigest,
    "Cannot merge different test matrices.",
  );
  for (const row of value.runs) {
    if (
      row.invalidForScoring ||
      ["operator_interrupted", "running"].includes(row.status)
    ) {
      excluded.push({ ...project(row, basename(dirname(path))), grade: null });
      continue;
    }
    const key = `${row.id}.${row.repetition}`;
    assert.ok(!selected.has(key), `Duplicate scored attempt ${key}`);
    assert.ok(grades.grades[key], `Missing semantic grade ${key}`);
    if (grades.grades[key].verdict === "pass")
      assert.ok(
        ["passed", "needs_semantic_grade"].includes(row.status),
        `Failed execution cannot pass: ${key}`,
      );
    selected.set(key, {
      raw: row,
      public: project(row, basename(dirname(path))),
    });
  }
}
assert.equal(
  selected.size,
  latest.cases.length * latest.repetitions,
  "Every frozen repetition must be accounted for.",
);
for (const scenario of latest.cases)
  for (let repeat = 1; repeat <= latest.repetitions; repeat++)
    assert.ok(selected.has(`${scenario.id}.${repeat}`));
const supplementary = supplementaryPath
  ? JSON.parse(await readFile(supplementaryPath, "utf8"))
  : null;
const allRows = segments
  .flatMap((s) => s.value.runs)
  .concat(supplementary?.runs ?? []);
const scored = [...selected.values()];
const summary = {
  protocol: latest.protocol,
  completedAt: latest.completedAt,
  baseline: latest.baseline,
  matrixDigest: latest.matrixDigest,
  gradingMethod: grades.method,
  segments: segments.map((s) => ({
    journal: basename(dirname(s.path)),
    sha256: s.sha256,
    source: s.value.source,
    frozenFiles: s.value.frozenFiles,
    resources: s.value.resources.length,
    cleanupVerified: s.value.resources.every((x) => x.cleaned),
  })),
  totals: {
    scoredRuns: scored.length,
    grades: scored.reduce((n, x) => {
      n[x.public.grade.verdict] = (n[x.public.grade.verdict] ?? 0) + 1;
      return n;
    }, {}),
    scoredUsage: usage(scored.map((x) => x.raw)),
    allUsage: usage(allRows),
  },
  runs: scored.map((x) => x.public),
  excluded,
  supplementary: supplementary
    ? {
        journal: basename(dirname(supplementaryPath)),
        reason: supplementary.interruption,
        usage: usage(supplementary.runs),
        runs: supplementary.runs.map((row) => ({
          ...project(row, basename(dirname(supplementaryPath))),
          grade: null,
        })),
      }
    : null,
};
await writeFile(
  join("docs/engineering/restyle-capability", "evidence.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary.totals, null, 2));
