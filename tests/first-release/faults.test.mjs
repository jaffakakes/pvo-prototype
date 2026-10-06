import assert from "node:assert/strict";
import test from "node:test";
import { injectSourceFault } from "../../scripts/checks/cloud-agent-first-release/faults.js";

test("the declared acceptance fault changes only the first generated service module and actually prevents execution", async () => {
  const decision = {
    kind: "tools",
    review: null,
    calls: [
      {
        kind: "workspace_write",
        expectedRevision: 0,
        files: [
          {
            path: "src/service.mjs",
            content:
              "export const execute = () => ({result: true, state: null});",
          },
          {
            path: "tests/service.test.mjs",
            content: "// Original generated tests remain unchanged",
          },
        ],
      },
    ],
  };
  const original = structuredClone(decision);
  const changed = injectSourceFault(decision);
  assert.deepEqual(decision, original);
  assert.deepEqual(
    changed.decision.calls[0].files[1],
    decision.calls[0].files[1],
  );
  const source = changed.decision.calls[0].files[0].content;
  await assert.rejects(
    import(`data:text/javascript,${encodeURIComponent(source)}`),
    /Acceptance injected module startup failure/,
  );
  assert.deepEqual(
    (
      await import(
        `data:text/javascript,${encodeURIComponent(original.calls[0].files[0].content)}`
      )
    ).execute(),
    { result: true, state: null },
  );
  assert.equal(injectSourceFault({ kind: "agreement", agreement: {} }), null);
});
