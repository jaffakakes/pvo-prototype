import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { scenarios } from "./scenarios.js";

/** Real model mode supplies no decisions/source. Each observed revision is checkpointed. */
export async function exerciseAuthoring(
  call,
  checkpoint,
  {
    expiresAt,
    pollMs = 3000,
    signal,
    start,
    onReady,
    answerQuestion,
    record = async () => {},
  } = {},
) {
  signal?.throwIfAborted();
  for (const subject of Object.keys(scenarios)) {
    signal?.throwIfAborted();
    const started = start
      ? await start(subject)
      : await call(`/${subject}/begin`, "POST");
    assert.equal(started.status, 200, `${subject}: task creation failed`);
    assert.ok(started.data.task?.id, `${subject}: missing saved task`);
    let revision = -1,
      answers = 0,
      retriedHosting = false;
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
      if (
        task.state === "failed" &&
        task.stepId === "host" &&
        !retriedHosting &&
        snapshot.faults?.some((f) => f.id === "hosting_unavailable")
      ) {
        const response = await call(`/${subject}/command`, "POST", {
          kind: "resume",
          id: task.id,
          input: { expectedRevision: task.revision },
        });
        assert.equal(response.status, 200);
        assert.ok(response.data.task);
        retriedHosting = true;
        await record("failed_hosting_resumed", { subject, taskId: task.id });
        continue;
      }
      const question = task.questions.find((q) => q.answer === null);
      if (question) {
        // Additional questions wait for a reviewed answer; they must not destroy the deployment.
        const value = await answerQuestion(
          subject,
          question,
          snapshot,
          answers,
        );
        assert.ok(typeof value === "string" && value.trim());
        const answer = await call(`/${subject}/command`, "POST", {
          kind: "answers",
          id: task.id,
          input: {
            expectedRevision: task.revision,
            questionId: question.id,
            questionRevision: question.revision,
            operationId: `answer-${subject}-${question.id}`,
            value,
          },
        });
        assert.equal(answer.status, 200);
        assert.ok(answer.data.task, `${subject}: answer was not saved`);
        await record("creator_question_answered", {
          subject,
          taskId: task.id,
          question: question.prompt,
          answer: value,
        });
        answers++;
      }
      assert.ok(
        !["failed", "stopped"].includes(task.state),
        `${subject}: task ${task.state}; inspect its checkpoint`,
      );
      if (task.wait?.reason === "spending_permission")
        throw new Error(
          `${subject}: task awaits permission; inspect its checkpoint`,
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
    if (onReady) await onReady(subject, final.data);
  }
}
