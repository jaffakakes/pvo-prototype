import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  entryPoints: ["editor/src/domain/assistant/buildDiagnostics.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { parseBuildDiagnostic } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const reference = { ownerId: "owner", projectId: "project", taskId: "task" };
const diagnostic = () => ({
  reference,
  stepId: "build",
  repair: {
    check: "builder_response",
    message: "A required field is missing.",
    repetitions: 3,
    proposal: { text: "<script>untrusted()</script>", truncated: false },
  },
});

test("build diagnostics require the exact account, project and task before exposing private text", () => {
  for (const field of ["ownerId", "projectId", "taskId"])
    assert.throws(() =>
      parseBuildDiagnostic(
        { ...diagnostic(), reference: { ...reference, [field]: "other" } },
        reference,
      ),
    );
  const value = diagnostic();
  assert.equal(
    parseBuildDiagnostic(value, reference).repair.proposal.text,
    value.repair.proposal.text,
  );
  assert.deepEqual(
    parseBuildDiagnostic({ ...value, repair: null }, reference),
    { stepId: "build", repair: null },
  );
});

test("malformed and oversized build details are rejected before rendering", () => {
  for (const mutate of [
    (value) => (value.repair.repetitions = "3"),
    (value) => (value.repair.repetitions = 0),
    (value) => (value.repair.message = "😀".repeat(513)),
    (value) => (value.repair.proposal.text = "😀".repeat(32769)),
    (value) => (value.repair.proposal.truncated = "false"),
    (value) => (value.repair = []),
  ]) {
    const value = diagnostic();
    mutate(value);
    assert.throws(() => parseBuildDiagnostic(value, reference));
  }
});
