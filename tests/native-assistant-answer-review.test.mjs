import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudflareTurn,
  nativeInput,
} from "./native-assistant-server.helpers.mjs";

const terminal = (message) => ({ message, operations: [], observations: [] });
const explanation = {
  ...terminal("The clip plays at twice its source speed."),
  answer:
    "The source spans 22 - 2 = 20 seconds. At 2× speed, 20 / 2 = 10 timeline seconds.",
};
const verdict = terminal("The explanation is complete and correct.");

function sequence(outputs) {
  const calls = [];
  return {
    calls,
    signal: new AbortController().signal,
    ai: {
      run: async (_model, input) => {
        calls.push(input);
        assert.ok(calls.length <= outputs.length, "Unexpected extra inference");
        return { response: outputs[calls.length - 1] };
      },
    },
  };
}

test("completion cannot replace a requested answer with a review verdict", async () => {
  for (const mode of ["ask", "plan"]) {
    const model = sequence([explanation, verdict, explanation]);
    const result = await cloudflareTurn(
      {
        ...nativeInput(),
        mode,
        prompt: "Explain the source and timeline duration. Do not edit.",
      },
      model,
    );
    assert.deepEqual(result, explanation);
    assert.equal(model.calls.length, 3);
    assert.match(model.calls[2].messages.at(-1).content, /answer/);
  }
});

test("review can correct an answer instead of blindly retaining the candidate", async () => {
  const wrong = {
    ...explanation,
    answer: "The clip lasts 20 timeline seconds.",
  };
  const model = sequence([wrong, explanation]);
  assert.deepEqual(
    await cloudflareTurn({ ...nativeInput(), mode: "ask" }, model),
    explanation,
  );
  assert.equal(model.calls.length, 2);
});

test("review may replace an unsupported answer with evidence inspection or a blocker", async () => {
  const inspection = {
    ...terminal("I need to inspect the relevant footage."),
    observations: [
      { kind: "frames", sceneId: "main", start: 0, end: 1, count: 1 },
    ],
  };
  const blocked = {
    ...terminal("That fact is unavailable in this project."),
    blocked: true,
  };
  for (const corrected of [inspection, blocked]) {
    const model = sequence([explanation, corrected]);
    assert.deepEqual(
      await cloudflareTurn({ ...nativeInput(), mode: "ask" }, model),
      corrected,
    );
    assert.equal(model.calls.length, 2);
  }
});

test("a repeated answer omission fails after the existing shared repair", async () => {
  const model = sequence([explanation, verdict, verdict]);
  await assert.rejects(
    cloudflareTurn({ ...nativeInput(), mode: "ask" }, model),
    (error) => error.status === 422,
  );
  assert.equal(model.calls.length, 3);
});
