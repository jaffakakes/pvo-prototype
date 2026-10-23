import assert from "node:assert/strict";
import test from "node:test";
import { validatePvo, PVO_SPEC_VERSION } from "../../packages/pvo-sdk/index.js";

const base = () => ({
  spec_version: PVO_SPEC_VERSION,
  scenes: [{ id: "main", start: 0, end: 4 }],
  components: [],
});
test("public manifest validation returns errors for malformed collections and members", () => {
  const malformed = [null, false, 42, "bad", {}, [null], [false], [[]]];
  for (const key of ["scenes", "components", "media", "hotspots", "triggers"]) {
    for (const value of malformed) {
      const result = validatePvo({ ...base(), [key]: value });
      assert.equal(result.valid, false, `${key}: ${JSON.stringify(value)}`);
      assert(result.errors.length > 0);
    }
  }
  for (const value of malformed) {
    for (const input of [
      { ...base(), playback: value },
      { ...base(), playback: { initial_timeline: "main", timelines: value } },
      { ...base(), playback: { timelines: [{ id: "main", clips: value }] } },
      {
        ...base(),
        components: [
          {
            id: "form",
            kind: "form",
            fields: value,
            on_submit: { type: "custom", name: "submit" },
          },
        ],
      },
      {
        ...base(),
        components: [{ id: "choice", kind: "choice", options: value }],
      },
    ])
      assert.equal(validatePvo(input).valid, false);
  }
  const branch = {
    ...base(),
    scenes: [
      {
        ...base().scenes[0],
        on_enter: { type: "branch", cases: { invalid: true } },
      },
    ],
  };
  assert.equal(validatePvo(branch).valid, false);
  assert.equal(
    validatePvo({ ...base(), components: [{ kind: "card", actions: [null] }] })
      .valid,
    false,
  );
});
