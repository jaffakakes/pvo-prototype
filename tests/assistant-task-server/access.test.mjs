import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, NOW, path, expectStatus, saved } from "./helpers.mjs";
import { question, answer } from "../assistant-tasks/fixtures.mjs";
import { TASK_LIMITS } from "../../packages/pvo-assistant/tasks/index.js";

test("every private operation requires the current account and same-origin writes", async () => {
  const fixture = await taskFixture();
  try {
    const task = await saved(fixture);
    const other = { session: fixture.otherCookie };
    const secondProject = await fixture.project("local-draft", other);
    assert.notEqual(secondProject.body.project.id, task.input.projectId);
    const accesses = [
      [path(task), {}],
      [`/api/assistant/tasks?project=${task.input.projectId}`, {}],
      [
        path(task) + "/answers",
        {
          body: {
            expectedRevision: 0,
            questionId: "date",
            questionRevision: 0,
            operationId: "answer",
            value: "Friday",
          },
        },
      ],
      [path(task) + "/resume", { body: { expectedRevision: 0 } }],
      [path(task) + "/stop", { body: { expectedRevision: 0 } }],
    ];
    for (const [route, options] of accesses) {
      expectStatus(await fixture.request(route, { ...options, ...other }), 404);
      expectStatus(
        await fixture.request(route, { ...options, session: null }),
        401,
      );
    }
    expectStatus(await fixture.create(task.input.projectId, {}, other), 404);
    expectStatus(await fixture.project("anonymous", { session: null }), 401);
    expectStatus(
      await fixture.create(task.input.projectId, {}, { session: null }),
      401,
    );
    for (const headers of [
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { "Sec-Fetch-Site": "cross-site" },
    ]) {
      expectStatus(await fixture.project("hostile", { headers }), 403);
      expectStatus(
        await fixture.request(path(task) + "/stop", {
          body: { expectedRevision: 0 },
          headers,
        }),
        403,
      );
    }
    expectStatus(
      await fixture.request(path(task), {
        session: fixture.cookie + "tampered",
      }),
      401,
    );
    expectStatus(
      await fixture.create(task.input.projectId, { ownerId: "other" }),
      400,
    );
    expectStatus(
      await fixture.request(path(task) + "/claim", {
        body: { claimId: "injected" },
      }),
      404,
    );
    expectStatus(
      await fixture.request(path(task) + "/stop", {
        body: { expectedRevision: 0, claim: null },
      }),
      400,
    );
    assert.equal((await fixture.request(path(task))).body.task.state, "queued");
  } finally {
    await fixture.close();
  }
});

test("malformed and oversized inputs, absent bindings and failed storage never report success", async () => {
  for (const settings of [{ storage: false }, { broken: true }]) {
    const fixture = await taskFixture(settings);
    try {
      expectStatus(await fixture.project(), 503);
    } finally {
      await fixture.close();
    }
  }
  const fixture = await taskFixture();
  try {
    const projectId = (await fixture.project()).body.project.id;
    expectStatus(await fixture.project("bad/id"), 400);
    expectStatus(
      await fixture.create(projectId, { request: "x".repeat(4001) }),
      400,
    );
    expectStatus(
      await fixture.create(projectId, {
        request: "x".repeat(TASK_LIMITS.inputBytes),
      }),
      413,
    );
    for (const query of [
      "",
      `?project=${projectId}&limit=21`,
      `?project=${projectId}&project=${projectId}`,
      `?project=${projectId}&owner=someone`,
      `?project=${projectId}&before=%00`,
    ])
      expectStatus(await fixture.request("/api/assistant/tasks" + query), 400);
    expectStatus(
      await fixture.create(
        projectId,
        {},
        { headers: { "Content-Type": "text/plain" } },
      ),
      415,
    );
    const task = (await fixture.create(projectId)).body.task;
    for (const expectedRevision of [-1, 1.5, "0"])
      expectStatus(
        await fixture.request(path(task) + "/stop", {
          body: { expectedRevision },
        }),
        400,
      );
  } finally {
    await fixture.close();
  }
});

test("saved planning capability requires a real signed account and storage, regardless of client claims", async () => {
  const fixture = await taskFixture();
  try {
    assert.equal((await fixture.request("/__capability")).body.available, true);
    for (const session of [null, fixture.cookie + "tampered"])
      assert.equal(
        (
          await fixture.request("/__capability", {
            session,
            headers: { "X-Assistant-Saved-Tasks": "1", "X-Owner-Id": "owner" },
          })
        ).body.available,
        false,
      );
    assert.equal(
      (await fixture.request("/__capability?without-storage")).body.available,
      false,
    );
  } finally {
    await fixture.close();
  }
});
