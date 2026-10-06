import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { scenarios } from "./scenarios.js";

/** Real model mode supplies no decisions/source. Each observed revision is checkpointed. */
export async function exerciseAuthoring(
  call,
  checkpoint,
  { expiresAt, pollMs = 3000, signal } = {},
) {
  signal?.throwIfAborted();
  for (const [subject, scenario] of Object.entries(scenarios)) {
    signal?.throwIfAborted();
    const started = await call(`/${subject}/begin`, "POST");
    assert.equal(started.status, 200, `${subject}: task creation failed`);
    assert.ok(started.data.task?.id, `${subject}: missing saved task`);
    let revision = -1,
      answered = false;
    while (Date.now() < expiresAt) {
      signal?.throwIfAborted();
      const response = await call(`/${subject}/status`);
      assert.equal(response.status, 200, `${subject}: status unavailable`);
      const snapshot = response.data,
        task = snapshot.task;
      assert.ok(task, `${subject}: saved task disappeared`);
      if (task.revision !== revision) {
        await checkpoint(subject, snapshot);
        revision = task.revision;
      }
      if (task.state === "ready") {
        assert.ok(snapshot.result, `${subject}: missing saved component`);
        assert.ok(snapshot.services.length, `${subject}: no hosted service`);
        assert.ok(
          snapshot.workspaces.length &&
            snapshot.workspaces.every((w) => w.absent),
          `${subject}: workspace is still running`,
        );
        break;
      }
      const question = task.questions.find((q) => q.answer === null);
      if (question) {
        // The reviewed scenario supplies one creator answer; extra questions need review.
        assert.equal(
          answered,
          false,
          `${subject}: another creator answer is needed; inspect the checkpoint`,
        );
        const answer = await call(`/${subject}/command`, "POST", {
          kind: "answers",
          id: task.id,
          input: {
            expectedRevision: task.revision,
            questionId: question.id,
            questionRevision: question.revision,
            operationId: `answer-${subject}`,
            value: scenario.answer,
          },
        });
        assert.equal(answer.status, 200);
        assert.ok(answer.data.task, `${subject}: answer was not saved`);
        answered = true;
      }
      assert.ok(
        !["failed", "stopped"].includes(task.state),
        `${subject}: task ${task.state}; inspect its checkpoint`,
      );
      if (task.wait)
        throw new Error(
          `${subject}: task awaits capacity or permission; inspect its checkpoint`,
        );
      await pause(pollMs, undefined, { signal });
    }
    const final = await call(`/${subject}/status`);
    assert.equal(
      final.data?.task?.state,
      "ready",
      `${subject}: acceptance time window ended`,
    );
    await checkpoint(subject, final.data);
  }
}
