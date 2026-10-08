import { alternative } from "../assistant-tasks/manual.fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { expectStatus, path, NOW } from "./helpers.mjs";
import { current, guard, rows } from "./workspace.helpers.mjs";
import {
  connection,
  decision,
  capabilityFixture,
} from "./capability-research.helpers.mjs";
import {
  evidenceNote,
  evidencePage,
} from "../assistant-builder/research-evidence.fixture.mjs";

const noConnection = {
  ...decision().basis,
  connectionId: null,
  adapterOperation: null,
};

test(
  "account inspection is private, paged, durable, credential-free and honestly empty until setup",
  { timeout: 20000 },
  async () => {
    const { fixture, start, execute, save } = await capabilityFixture();
    try {
      const task = await start();
      assert.deepEqual(
        (
          await execute(
            task,
            { kind: "connections_read", after: null },
            "empty",
          )
        ).result,
        { connections: [], next: null, version: 0 },
      );
      const forbidden = await fixture.control({
        action: "save-connection",
        connection: { ...connection(), token: "must-not-be-stored" },
        expectedRevision: 0,
      });
      expectStatus(forbidden, 409);
      for (let index = 0; index < 6; index++)
        await save(connection({ id: `account-${index}` }));
      await fixture.restart();
      const first = await execute(
        task,
        { kind: "connections_read", after: null },
        "first",
      );
      assert.equal(first.result.connections.length, 4);
      assert.equal(first.result.next, "account-3");
      const second = await execute(
        task,
        { kind: "connections_read", after: first.result.next },
        "second",
      );
      assert.equal(second.result.connections.length, 2);
      assert.equal(second.result.next, null);
      assert.deepEqual(first.result.connections[0].permissions, [
        "calendar.read",
      ]);
      expectStatus(
        await fixture.request("/__test", {
          body: {
            action: "research-tool",
            id: task.id,
            tool: { kind: "connections_read", after: null },
            operationId: "foreign",
            guard: guard(await current(fixture, task)),
          },
          session: fixture.otherCookie,
        }),
        409,
      );
      assert.equal((await rows(fixture)).links.length, 0);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "capability branches distinguish documented access, setup, adapter work, manual steps and uncertainty",
  { timeout: 20000 },
  async () => {
    const { fixture, start, execute, save } = await capabilityFixture();
    try {
      await save();
      const task = await start();
      const record = await execute(task, decision(), "ready");
      assert.equal(record.status, "completed");
      assert.equal(record.result.verification, "planning_only");
      assert.equal(
        (
          await execute(
            task,
            decision({ status: "needs_account", basis: noConnection }),
            "setup",
          )
        ).status,
        "completed",
      );
      assert.equal(
        (
          await execute(
            task,
            decision({ status: "needs_adapter", basis: noConnection }),
            "adapter",
          )
        ).status,
        "completed",
      );
      assert.equal(
        (
          await execute(
            task,
            decision({
              status: "manual",
              selection: "proposed",
              basis: noConnection,
            }),
            "manual",
          )
        ).status,
        "completed",
      );
      assert.equal(
        (
          await execute(
            task,
            decision({
              status: "unverified",
              basis: { ...noConnection, evidenceIds: [] },
            }),
            "unknown",
          )
        ).status,
        "completed",
      );
      for (const [key, change] of Object.entries({
        account: { basis: noConnection },
        operation: { basis: { ...decision().basis, adapterOperation: "book" } },
        scope: {
          basis: { ...decision().basis, permissions: ["calendar.write"] },
        },
        documentation: { basis: { ...decision().basis, evidenceIds: [] } },
        mismatch: { operation: "Send an invitation" },
        permissionFromWebsite: {
          basis: { ...noConnection, permissions: ["calendar.read"] },
        },
        unchosenManual: { status: "manual", basis: noConnection },
        forgedAnswer: { answerQuestionId: "someone-elses-question" },
      }))
        assert.equal(
          (await execute(task, decision(change), `reject-${key}`)).status,
          "unavailable",
          key,
        );
      await save(connection({ status: "expired", revision: 2 }));
      assert.equal(
        (await execute(task, decision(), "stale")).status,
        "unavailable",
      );
      await execute(
        task,
        { kind: "connections_read", after: null },
        "expired-account",
      );
      assert.equal(
        (
          await execute(
            task,
            decision({
              basis: {
                ...decision().basis,
                connectionReadId: "expired-account",
              },
            }),
            "expired",
          )
        ).status,
        "unavailable",
      );
      const other = await start("another-task");
      assert.equal(
        (
          await execute(
            other,
            decision({
              basis: {
                ...decision().basis,
                evidenceIds: ["does-not-belong-here"],
              },
            }),
            "foreign-note",
          )
        ).status,
        "unavailable",
      );
      assert.equal((await rows(fixture)).links.length, 0);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "saved choices reuse answers and detect changed requirements, revoked access and actual source changes",
  { timeout: 20000 },
  async () => {
    const { fixture, start, execute, save, setPage } =
      await capabilityFixture();
    try {
      await save();
      let task = await start();
      const chosen = await execute(task, decision(), "choice");
      await fixture.restart();
      assert.deepEqual(await execute(task, decision(), "choice"), chosen);
      const context = async () =>
        (await fixture.control({ action: "capability-context", id: task.id }))
          .body.decisions[0];
      assert.equal((await context()).current, true);
      assert.equal(
        (
          await execute(
            task,
            decision({ outcome: "Show all private event details" }),
            "silent-change",
          )
        ).status,
        "unavailable",
      );
      await execute(
        task,
        { kind: "web_read", url: evidencePage.url },
        "same-page-new-time",
      );
      assert.equal((await context()).current, true);
      setPage(
        `${evidencePage.text} Access now also requires administrator approval.`,
      );
      await execute(
        task,
        { kind: "web_read", url: evidencePage.url },
        "changed-page",
      );
      assert.equal((await context()).current, false);
      assert.equal(
        (await execute(task, decision(), "stale-docs")).status,
        "unavailable",
      );
      await execute(
        task,
        evidenceNote({ sourceOperationId: "changed-page" }),
        "new-evidence",
      );
      const changed = decision({
        basis: { ...decision().basis, evidenceIds: ["new-evidence"] },
        status: "unverified",
        reason: "Administrator permission needs checking.",
      });
      assert.equal(
        (await execute(task, changed, "reconsider")).status,
        "completed",
      );
      await save(connection({ status: "revoked", revision: 2 }));
      assert.equal((await context()).current, false);
      expectStatus(
        await fixture.control({
          action: "step",
          id: task.id,
          command: {
            kind: "ask",
            question: {
              id: "choose",
              revision: 0,
              prompt: "Access changed. Prepare a manual availability request?",
              choices: ["Use this alternative"],
              alternative: alternative({
                originalOutcome: decision().operation,
                preparedOutcome: "Prepare a request for a person to handle.",
              }),
              answer: null,
            },
          },
        }),
        200,
      );
      task = await current(fixture, task);
      expectStatus(
        await fixture.request(`${path(task)}/answers`, {
          method: "POST",
          body: {
            expectedRevision: task.revision,
            questionId: "choose",
            questionRevision: 0,
            operationId: "answer-choice",
            value: "Use this alternative",
          },
        }),
        200,
      );
      expectStatus(
        await fixture.control({
          action: "step",
          id: task.id,
          command: { kind: "claim", claimId: "next", leaseMs: 60000 },
        }),
        200,
      );
      await execute(
        task,
        { kind: "connections_read", after: null },
        "revoked-account",
      );
      const manual = decision({
        status: "manual",
        outcome: "Prepare a request for a person to handle.",
        answerQuestionId: "choose",
        basis: {
          ...noConnection,
          evidenceIds: ["new-evidence"],
          connectionReadId: "revoked-account",
        },
      });
      assert.equal(
        (await execute(task, manual, "chosen-manual")).status,
        "completed",
      );
      assert.equal((await context()).decision.outcome, manual.outcome);
      task = await current(fixture, task);
      expectStatus(
        await fixture.request(`${path(task)}/stop`, {
          body: { expectedRevision: task.revision },
        }),
        200,
      );
      task = await current(fixture, task);
      expectStatus(
        await fixture.request(`${path(task)}/manual`, {
          body: {
            expectedRevision: task.revision,
            questionId: "choose",
            stepId: "book",
            operationId: "cancel-manual",
            status: "cancelled",
            note: "No longer needed for this test.",
          },
        }),
        200,
      );
      expectStatus(
        await fixture.control({ action: "time", now: NOW + 31 * 86400000 }),
        200,
      );
      await fixture.control({ action: "sweep" });
      assert.equal(
        (await fixture.control({ action: "research-rows" })).body.length,
        0,
      );
    } finally {
      await fixture.close();
    }
  },
);

test(
  "an archived creator choice is reusable after restart and cannot be silently replaced",
  { timeout: 20000 },
  async () => {
    const { fixture, start, execute } = await capabilityFixture();
    try {
      let task = await start();
      for (let index = 0; index < 20; index++) {
        expectStatus(
          await fixture.control({
            action: "step",
            id: task.id,
            command: {
              kind: "ask",
              question: {
                id: `choice-${index}`,
                revision: 0,
                prompt:
                  index === 0
                    ? "Collect details for a person to handle?"
                    : `Missing requirement ${index}?`,
                choices: [],
                ...(index === 0
                  ? {
                      alternative: alternative({
                        originalOutcome: decision().operation,
                        preparedOutcome: "Collect details for a person",
                      }),
                    }
                  : {}),
                answer: null,
              },
            },
          }),
          200,
        );
        task = await current(fixture, task);
        expectStatus(
          await fixture.request(`${path(task)}/answers`, {
            body: {
              expectedRevision: task.revision,
              questionId: `choice-${index}`,
              questionRevision: 0,
              operationId: `answer-${index}`,
              value: index === 0 ? "Use this alternative" : `Choice ${index}`,
            },
          }),
          200,
        );
        expectStatus(
          await fixture.control({
            action: "step",
            id: task.id,
            command: {
              kind: "claim",
              claimId: `claim-${index}`,
              leaseMs: 60000,
            },
          }),
          200,
        );
      }
      task = await current(fixture, task);
      assert.ok(task.archivedQuestions > 0);
      assert.equal(
        task.questions.some((question) => question.id === "choice-0"),
        false,
      );
      await fixture.restart();
      const prior = await fixture.control({
        action: "question-reuse",
        id: task.id,
        prompt: "collect details for a person to handle?",
      });
      expectStatus(prior, 200);
      assert.equal(prior.body.answer.value, "Use this alternative");
      const chosen = decision({
        status: "manual",
        outcome: "Collect details for a person",
        basis: noConnection,
        answerQuestionId: "choice-0",
      });
      assert.equal(
        (await execute(task, chosen, "archived-choice")).status,
        "completed",
      );
      assert.equal(
        (
          await execute(
            task,
            { ...chosen, outcome: "Claim the external action is complete" },
            "change-without-answer",
          )
        ).status,
        "unavailable",
      );
    } finally {
      await fixture.close();
    }
  },
);

test(
  "new account setup and newly discovered conflicting documentation invalidate an earlier decision",
  { timeout: 20000 },
  async () => {
    const { fixture, start, execute, save, setPage } =
      await capabilityFixture();
    try {
      const task = await start();
      const tool = decision({ status: "needs_account", basis: noConnection });
      assert.equal(
        (await execute(task, tool, "needs-setup")).status,
        "completed",
      );
      const context = async () =>
        (await fixture.control({ action: "capability-context", id: task.id }))
          .body.decisions[0];
      assert.equal((await context()).current, true);
      await save();
      assert.equal((await context()).current, false);
      assert.equal(
        (await execute(task, tool, "stale-empty-list")).status,
        "unavailable",
      );
      await execute(
        task,
        { kind: "connections_read", after: null },
        "connected-now",
      );
      const available = decision({
        basis: { ...decision().basis, connectionReadId: "connected-now" },
      });
      assert.equal(
        (await execute(task, available, "ready-now")).status,
        "completed",
      );
      assert.equal((await context()).current, true);
      setPage(
        "Access to this API depends on account review. Eligibility is not described.",
      );
      await execute(
        task,
        { kind: "web_read", url: "https://calendar.example.com/docs/approval" },
        "approval-docs",
      );
      await execute(
        task,
        evidenceNote({
          sourceOperationId: "approval-docs",
          support: "unclear",
          excerpts: ["Eligibility is not described."],
          uncertainty: ["Eligibility for this operation cannot be established"],
        }),
        "approval-evidence",
      );
      assert.equal((await context()).current, false);
      assert.equal(
        (await execute(task, available, "ignore-conflict")).status,
        "unavailable",
      );
      assert.equal(
        (
          await execute(
            task,
            { ...available, status: "unverified" },
            "preserve-uncertainty",
          )
        ).status,
        "completed",
      );
    } finally {
      await fixture.close();
    }
  },
);
