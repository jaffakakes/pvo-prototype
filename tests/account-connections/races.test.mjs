import assert from "node:assert/strict";
import test from "node:test";
import { fixture, connectInput } from "./helpers.mjs";
import { expectStatus } from "../assistant-task-server/helpers.mjs";

async function blockedProvider(f) {
  let release, started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  f.api.held = new Promise((resolve) => {
    release = resolve;
  });
  const before = f.api.calls.length;
  const timer = setInterval(() => {
    if (f.api.calls.length > before) {
      clearInterval(timer);
      started();
    }
  }, 5);
  return {
    began,
    release: () => {
      clearInterval(timer);
      f.api.held = null;
      release();
    },
  };
}

test("disconnect fences an in-flight read and a late reconnect cannot restore the deleted key", async () => {
  const f = await fixture();
  let hold;
  try {
    expectStatus(await f.connection("connect", connectInput()), 200);
    hold = await blockedProvider(f);
    const reading = f.connection("invoke", {
      id: "connection-one",
      call: { operation: "github_repository_read", input: {} },
    });
    await hold.began;
    expectStatus(
      await f.connection("disconnect", {
        id: "connection-one",
        expectedRevision: 1,
      }),
      200,
    );
    hold.release();
    expectStatus(await reading, 409);
    expectStatus(
      await f.connection("connect", connectInput("connection-one", 2)),
      200,
    );
    hold = await blockedProvider(f);
    const reconnecting = f.connection(
      "connect",
      connectInput("connection-one", 3),
    );
    await hold.began;
    expectStatus(
      await f.connection("disconnect", {
        id: "connection-one",
        expectedRevision: 3,
      }),
      200,
    );
    hold.release();
    expectStatus(await reconnecting, 409);
    const list = await f.list();
    assert.equal(list.body.items[0].connection.status, "revoked");
    assert.equal(
      (await f.control({ action: "connection-storage" })).body[0].credential,
      null,
    );
  } finally {
    hold?.release();
    await f.close();
  }
});
