import assert from "node:assert/strict";
import test from "node:test";
import { fixture, connectInput, TOKEN, setup } from "./helpers.mjs";
import { expectStatus, NOW } from "../assistant-task-server/helpers.mjs";

test("connect, encrypted persistence, reload, controlled reads, access expiry, reconnect and revoke", async () => {
  const f = await fixture();
  try {
    const connected = await f.connection("connect", connectInput());
    expectStatus(connected, 200);
    assert.equal(connected.body.connection.status, "connected");
    assert.equal(JSON.stringify(connected.body).includes(TOKEN), false);
    assert.equal(f.api.calls.length, 3);
    assert.ok(
      f.api.calls.every(
        (call) =>
          call.method === "GET" &&
          new URL(call.url).origin === "https://api.github.com",
      ),
    );
    const storage = await f.control({ action: "connection-storage" });
    assert.equal(storage.body.length, 1);
    assert.equal(JSON.stringify(storage.body).includes(TOKEN), false);
    assert.ok(JSON.parse(storage.body[0].credential).body);
    await f.restart();
    assert.equal(
      (await f.list()).body.items[0].connection.id,
      "connection-one",
    );
    const read = await f.connection("invoke", {
      id: "connection-one",
      call: { operation: "github_issues_list", input: { page: 1 } },
    });
    expectStatus(read, 200);
    assert.equal(read.body.result.items[0].title, "Example issue");
    f.api.reject = true;
    const expired = await f.connection("check", {
      id: "connection-one",
      expectedRevision: 1,
    });
    expectStatus(expired, 409);
    assert.equal(JSON.stringify(expired.body).includes(TOKEN), false);
    let current = (await f.list()).body.items[0];
    assert.equal(current.connection.status, "expired");
    assert.equal(
      (await f.control({ action: "connection-storage" })).body[0].credential,
      null,
    );
    f.api.reject = false;
    expectStatus(
      await f.connection(
        "connect",
        connectInput("connection-one", current.connection.revision),
      ),
      200,
    );
    current = (await f.list()).body.items[0];
    expectStatus(
      await f.connection("disconnect", {
        id: "connection-one",
        expectedRevision: current.connection.revision,
      }),
      200,
    );
    const count = f.api.calls.length;
    expectStatus(
      await f.connection("connect", connectInput("wrong-account"), {
        session: f.otherCookie,
        headers: { "X-Restyle-Owner": f.owner },
      }),
      403,
    );
    expectStatus(
      await f.connection("invoke", {
        id: "connection-one",
        call: { operation: "github_repository_read", input: {} },
      }),
      409,
    );
    assert.equal(f.api.calls.length, count);
    assert.equal((await f.list()).body.items[0].connection.status, "revoked");
  } finally {
    await f.close();
  }
});

test("owner, CSRF, closed scopes and fixed operations fence credentials before network dispatch", async () => {
  const f = await fixture();
  try {
    expectStatus(await f.connection("connect", connectInput()), 200);
    const count = f.api.calls.length;
    expectStatus(
      await f.connection(
        "invoke",
        {
          id: "connection-one",
          call: { operation: "github_issues_list", input: { page: 1 } },
        },
        { session: f.otherCookie },
      ),
      404,
    );
    expectStatus(
      await f.connection(
        "disconnect",
        { id: "connection-one", expectedRevision: 1 },
        { headers: { Origin: "https://attacker.test" } },
      ),
      403,
    );
    expectStatus(
      await f.connection("invoke", {
        id: "connection-one",
        call: {
          operation: "github_issues_list",
          input: { page: 1, url: "https://attacker.test" },
        },
      }),
      400,
    );
    expectStatus(
      await f.connection("invoke", {
        id: "connection-one",
        call: { operation: "github_write", input: {} },
      }),
      400,
    );
    expectStatus(
      await f.connection("connect", {
        ...connectInput("evil"),
        setup: { ...setup, repository: "octocat/../../evil" },
      }),
      400,
    );
    expectStatus(
      await f.connection("connect", {
        ...connectInput("evil"),
        token: "ghp_classic_token_with_broad_permissions",
      }),
      400,
    );
    assert.equal(f.api.calls.length, count);
    expectStatus(
      await f.request("/api/account-connections", { session: null }),
      401,
    );
  } finally {
    await f.close();
  }
});

test("known time expiry is persisted and cannot dispatch, and missing wrapping keys fail closed", async () => {
  const f = await fixture();
  try {
    expectStatus(await f.connection("connect", connectInput()), 200);
    expectStatus(await f.control({ action: "time", now: NOW + 86400001 }), 200);
    assert.equal((await f.list()).body.items[0].connection.status, "expired");
    const count = f.api.calls.length;
    expectStatus(
      await f.connection("check", {
        id: "connection-one",
        expectedRevision: 2,
      }),
      409,
    );
    assert.equal(f.api.calls.length, count);
  } finally {
    await f.close();
  }
  const missing = await fixture({ connectionKey: null });
  try {
    expectStatus(await missing.connection("connect", connectInput()), 503);
    assert.equal(missing.api.calls.length, 0);
    assert.equal((await missing.list()).body.available, false);
  } finally {
    await missing.close();
  }
});

test("account access outlives terminal task cleanup without retaining task contents", async () => {
  const f = await fixture();
  try {
    f.api.expiresAt = NOW + 400 * 86400000;
    expectStatus(await f.connection("connect", connectInput()), 200);
    const project = (await f.project()).body.project;
    const task = (await f.create(project.id)).body.task;
    expectStatus(
      await f.request(`/api/assistant/tasks/${task.id}/stop`, {
        body: { expectedRevision: task.revision },
      }),
      200,
    );
    expectStatus(
      await f.control({ action: "time", now: NOW + 120 * 86400000 }),
      200,
    );
    expectStatus(await f.request(`/api/assistant/tasks/${task.id}`), 404);
    assert.equal((await f.list()).body.items[0].connection.status, "connected");
    expectStatus(
      await f.connection("invoke", {
        id: "connection-one",
        call: { operation: "github_repository_read", input: {} },
      }),
      200,
    );
  } finally {
    await f.close();
  }
});
