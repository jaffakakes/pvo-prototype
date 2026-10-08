import assert from "node:assert/strict";
import {
  dinnerAgreement,
  packageFor,
  dinnerSource,
} from "../service-validation/fixtures.mjs";
export const draftContent = (broken = false) => {
  const source = packageFor(
    broken
      ? dinnerSource.replace(
          "state.guests.length >= state.capacity",
          "state.guests.length > state.capacity",
        )
      : dinnerSource,
  );
  source.files.find((file) => file.path === source.tests[0]).content =
    "import assert from 'node:assert/strict'; import {execute} from '../src/service.mjs'; assert.equal(execute({operation:'join',input:{name:'Guest'},state:{capacity:1,guests:[]}}).result,'accepted');";
  return {
    agreement: dinnerAgreement(),
    entrypoint: source.entrypoint,
    files: source.files,
    tests: source.tests,
  };
};
export async function repairDecision(request) {
  const task = await request.json(),
    d = task.draftContext,
    m = d.maintenance;
  assert.equal(
    task.stepId,
    "plan",
    "Repair tools are selected deterministically",
  );
  if (!m.diagnosis)
    return Response.json({
      kind: "diagnose",
      stage: "backend_rule",
      evidenceKeys: ["baseline"],
      summary:
        "The capacity boundary admits one extra person. Preserve existing guests and correct the comparison.",
    });
  if (!d.read)
    return Response.json({ kind: "read", path: "src/service.mjs", offset: 0 });
  if (d.revision === 1)
    return Response.json({
      kind: "write",
      expectedRevision: d.revision,
      files: [
        { path: "src/service.mjs", content: dinnerSource },
        {
          path: d.metadata.tests[0],
          content:
            "import assert from 'node:assert/strict'; import {execute} from '../src/service.mjs'; const state={capacity:1,guests:['Existing']}; assert.deepEqual(execute({operation:'join',input:{name:'New'},state}), {result:'full',state});",
        },
      ],
      entrypoint: d.metadata.entrypoint,
      tests: d.metadata.tests,
      agreementJson: JSON.stringify(d.metadata.agreement),
      libraries: [],
    });
  return Response.json({
    kind: "execute",
    reason:
      "Verify the capacity regression and every original independent behavior case.",
  });
}
