import assert from "node:assert/strict";
import test from "node:test";
import { pressureBuilds } from "../../scripts/checks/restyle-capability/pressure-builds.mjs";
import { pressureProbes } from "../../scripts/checks/restyle-capability/pressure-probes.mjs";
import { references } from "../../scripts/checks/restyle-capability/pressure-references.mjs";
import { runCases } from "../../scripts/checks/model-comparison/review.mjs";
import { runPlanning } from "../../scripts/checks/restyle-capability/planning.mjs";
import { parseNativeTurnRequest } from "../../packages/pvo-assistant/native/index.js";
import { comparisonSandbox } from "../../scripts/checks/model-comparison/sandbox.mjs";
import { writeFile } from "node:fs/promises";
import { runPressureNative } from "../../scripts/checks/restyle-capability/pressure-native.mjs";

test("pressure references agree with hand-calculated anchors and leave input untouched", () => {
  assert.deepEqual(
    references.B1({ input: { answers: ["red", "blue", "skip"] }, state: null }),
    { state: null, result: { winner: "tie", answered: 2 } },
  );
  assert.equal(
    references.B2({
      input: { budget: 15, preferences: ["quiet"] },
      state: null,
    }).result,
    "B",
  );
  assert.equal(
    references.B2({
      input: { budget: 10, preferences: ["quiet"] },
      state: null,
    }).result,
    "A",
  );
  const state = { capacity: 1, active: ["A"], waiting: ["B", "C"] };
  assert.deepEqual(
    references.B3({ operation: "cancel", input: { name: "A" }, state }),
    {
      state: { capacity: 1, active: ["B"], waiting: ["C"] },
      result: "cancelled",
    },
  );
  assert.deepEqual(state.active, ["A"]);
  assert.equal(
    references.B4({
      input: { items: [{ id: "pen", quantity: 1 }], discount: true },
      state: [],
    }).result.cents,
    113,
  );
  assert.equal(
    references.B4({
      input: {
        items: [
          { id: "pen", quantity: 1 },
          { id: "pen", quantity: 1 },
        ],
        discount: true,
      },
      state: [],
    }).result.cents,
    225,
  );
});

test("sealed grading accepts reference/field-order variants and rejects plausible wrong outcomes", async () => {
  for (const scenario of pressureBuilds()) {
    if (!references[scenario.id]) continue;
    const reference = references[scenario.id];
    const sandbox = {
      execute: async (_files, _entry, invocation) => reference(invocation),
    };
    const pkg = { files: [], entrypoint: "src/main.mjs" };
    const rows = await runCases(
      sandbox,
      pkg,
      scenario.agreement,
      scenario.sealedCases,
    );
    assert.ok(
      rows.every((row) => row.status === "passed"),
      scenario.id,
    );
    const reordered = {
      execute: async (...args) => {
        const reply = await sandbox.execute(...args);
        return { result: reply.result, state: reply.state };
      },
    };
    assert.ok(
      (
        await runCases(reordered, pkg, scenario.agreement, scenario.sealedCases)
      ).every((row) => row.status === "passed"),
    );
    const broken = {
      execute: async (_files, _entry, invocation) => {
        const reply = reference(invocation);
        if (scenario.id === "B1" && reply.result.winner === "tie")
          reply.result.winner = "red";
        if (scenario.id === "B2") reply.result = "B";
        if (scenario.id === "B3" && invocation.operation === "cancel")
          reply.state = invocation.state;
        if (
          scenario.id === "B4" &&
          invocation.input.discount &&
          invocation.input.items.some((item) => item.id === "pen")
        )
          reply.result.cents++;
        return reply;
      },
    };
    assert.ok(
      (
        await runCases(broken, pkg, scenario.agreement, scenario.sealedCases)
      ).some((row) => row.status === "failed"),
      scenario.id,
    );
  }
});

test("pressure inputs remain valid and scripted answers continue without model-format coaching", async () => {
  const probes = pressureProbes();
  for (const probe of probes.filter((item) => item.family === "editor"))
    parseNativeTurnRequest(probe.request);
  const scenario = probes.find((item) => item.id === "A1");
  const row = {};
  let calls = 0;
  await runPlanning(
    scenario,
    row,
    {
      generate: async ({ messages }) => {
        calls++;
        if (calls === 2)
          assert.ok(JSON.stringify(messages).includes("Only I may read them"));
        return {
          content: JSON.stringify({
            kind: "ask",
            prompt:
              calls === 1
                ? "What should be collected and who can read it?"
                : "Still unsure",
            choices: [],
          }),
        };
      },
    },
    async () => {},
  );
  assert.equal(calls, 2);
  assert.equal(row.scriptedAnswers.length, 1);
  assert.equal(row.validationRepairs, 0);
  assert.equal(scenario.questions.length, 0);
});

test(
  "real isolated pressure grader accepts correct source and rejects a false success",
  { skip: !process.env.RESTYLE_PRESSURE_CALIBRATION_JOURNAL, timeout: 120000 },
  async () => {
    const resources = new Map();
    const save = async () =>
      writeFile(
        process.env.RESTYLE_PRESSURE_CALIBRATION_JOURNAL,
        JSON.stringify({ resources: [...resources.values()] }, null, 2),
        { mode: 0o600 },
      );
    const sandbox = await comparisonSandbox(async (resource) => {
      resources.set(resource.name, structuredClone(resource));
      await save();
    });
    for (const scenario of pressureBuilds().filter(
      (item) => references[item.id],
    )) {
      const reference = references[scenario.id];
      const pkg = {
        entrypoint: "src/main.mjs",
        files: [
          {
            path: "src/main.mjs",
            content: `export const execute = ${reference.toString()};`,
          },
        ],
      };
      const correct = await runCases(sandbox, pkg, scenario.agreement, [
        scenario.sealedCases[0],
      ]);
      assert.equal(correct[0].status, "passed", scenario.id);
      pkg.files[0].content =
        "export function execute({state}) {return {state,result:'success'};}";
      const wrong = await runCases(sandbox, pkg, scenario.agreement, [
        scenario.sealedCases[0],
      ]);
      assert.equal(wrong[0].status, "failed", scenario.id);
    }
    assert.ok([...resources.values()].every((row) => row.cleaned));
  },
);

test("native pressure driver verifies actual working-copy commit and preserves style", async () => {
  const scenario = pressureProbes().find((item) => item.id === "E2");
  const row = {};
  let count = 0;
  await runPressureNative(
    scenario,
    row,
    {
      generate: async () => ({
        content: JSON.stringify({
          message: "Prepared",
          observations: [],
          operations:
            ++count === 1
              ? [
                  {
                    kind: "text.update",
                    sceneId: "main",
                    textId: 20,
                    changes: { start: 3, end: 5 },
                  },
                ]
              : [],
        }),
      }),
    },
    async () => {},
  );
  assert.equal(row.status, "passed");
  assert.equal(row.commits, 1);
});
