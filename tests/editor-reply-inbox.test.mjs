import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `export { createReplyInboxWorkflow, emptyReplyInbox } from "./editor/src/features/replies/replyInboxWorkflow.ts";
      export { RepliesHttpError } from "./editor/src/infrastructure/replies/client.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { createReplyInboxWorkflow, emptyReplyInbox, RepliesHttpError } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const box = (id) => ({
  id,
  title: id,
  createdAt: "2026-10-04T12:00:00Z",
  count: 1,
  url: `https://example.test/${id}`,
});
const reply = (value) => ({
  id: value,
  createdAt: "2026-10-04T12:00:00Z",
  answers: [{ name: "Name", type: "text", value }],
});

function fixture() {
  let account = { available: true, userId: "owner-a" };
  let state = emptyReplyInbox();
  const changes = [];
  const deletions = [];
  const adapters = {
    account: () => account,
    refreshAccount: async () => account,
    requireAccount: async () => false,
    changed: (next) => {
      state = next;
      changes.push(next);
    },
    client: {
      listBoxes: async () => [box("first"), box("second")],
      listReplies: async (id) => [reply(id)],
      deleteBox: async (id) => {
        deletions.push(id);
      },
    },
  };
  const workflow = createReplyInboxWorkflow(adapters);
  return {
    adapters,
    workflow,
    changes,
    deletions,
    get state() {
      return state;
    },
    account: (userId, available = true) => {
      account = { userId, available };
      workflow.accountChanged(userId);
    },
  };
}

test("only the selected box request can publish replies or finish busy feedback", async () => {
  const f = fixture();
  await f.workflow.loadBoxes();
  const first = deferred();
  const second = deferred();
  const signals = [];
  f.adapters.client.listReplies = (id, signal) => {
    signals.push(signal);
    return id === "first" ? first.promise : second.promise;
  };
  const oldRequest = f.workflow.openBox(box("first"));
  const newRequest = f.workflow.openBox(box("second"));
  assert.equal(signals[0].aborted, true);
  first.resolve([reply("stale")]);
  await oldRequest;
  assert.equal(f.state.selectedId, "second");
  assert.equal(f.state.busy, true);
  assert.equal(f.state.replies, null);
  second.resolve([reply("current")]);
  await newRequest;
  assert.deepEqual(f.state.replies, [reply("current")]);
  assert.equal(f.state.busy, false);
});

for (const nextOwner of [null, "owner-b"]) {
  test(`changing account to ${nextOwner} clears private inbox data and rejects late replies`, async () => {
    const f = fixture();
    await f.workflow.loadBoxes();
    const pending = deferred();
    let signal;
    f.adapters.client.listReplies = (_id, value) => {
      signal = value;
      return pending.promise;
    };
    const request = f.workflow.openBox(box("first"));
    f.account(nextOwner);
    assert.equal(signal.aborted, true);
    assert.deepEqual(f.state.boxes, []);
    assert.equal(f.state.selectedId, null);
    assert.equal(f.state.busy, false);
    assert.equal(f.state.requiresSignIn, nextOwner === null);
    pending.resolve([reply("previous owner's answer")]);
    await request;
    assert.equal(f.state.replies, null);
    assert.equal(f.state.message, null);
  });
}

test("initial sign-in may finish its own inbox load", async () => {
  const f = fixture();
  f.account(null);
  f.adapters.requireAccount = async () => {
    f.account("new-owner");
    return true;
  };
  await f.workflow.loadBoxes();
  assert.equal(f.state.boxes.length, 2);
  assert.equal(f.state.requiresSignIn, false);
  assert.equal(f.state.busy, false);
});

test("superseded account checks cannot reopen sign-in or replace the current list", async () => {
  const f = fixture();
  const oldAccount = deferred();
  let reads = 0;
  let signIns = 0;
  f.adapters.refreshAccount = () =>
    ++reads === 1
      ? oldAccount.promise
      : Promise.resolve({ available: true, userId: "owner-a" });
  f.adapters.requireAccount = async () => {
    signIns++;
    return false;
  };
  const oldRequest = f.workflow.loadBoxes();
  await f.workflow.loadBoxes();
  oldAccount.resolve({ available: true, userId: null });
  await oldRequest;
  assert.equal(signIns, 0);
  assert.equal(f.state.boxes.length, 2);
  assert.equal(f.state.requiresSignIn, false);
});

test("leaving a box cancels its read while retaining the box list", async () => {
  const f = fixture();
  await f.workflow.loadBoxes();
  const pending = deferred();
  f.adapters.client.listReplies = () => pending.promise;
  const request = f.workflow.openBox(box("first"));
  f.workflow.back();
  pending.resolve([reply("late")]);
  await request;
  assert.equal(f.state.selectedId, null);
  assert.equal(f.state.replies, null);
  assert.equal(f.state.boxes.length, 2);
  assert.equal(f.state.busy, false);
});

test("loading and selecting never delete; explicit deletion retains a failed box for retry", async () => {
  const f = fixture();
  await f.workflow.loadBoxes();
  await f.workflow.openBox(box("first"));
  assert.deepEqual(f.deletions, []);
  f.adapters.client.deleteBox = async () => {
    throw new Error("offline");
  };
  await f.workflow.removeBox(box("first"));
  assert.equal(f.state.selectedId, "first");
  assert.equal(f.state.boxes.length, 2);
  assert.equal(f.state.message, "Couldn’t delete this box. Try again.");
  f.adapters.client.deleteBox = async (id) => {
    f.deletions.push(id);
  };
  await f.workflow.removeBox(box("first"));
  assert.deepEqual(f.deletions, ["first"]);
  assert.deepEqual(
    f.state.boxes.map((item) => item.id),
    ["second"],
  );
  assert.equal(f.state.selectedId, null);
  assert.equal(f.state.replies, null);
  assert.equal(f.state.message, null);
});

test("a late deletion result cannot clear the next account's inbox", async () => {
  const f = fixture();
  await f.workflow.loadBoxes();
  const deletion = deferred();
  f.adapters.client.deleteBox = () => deletion.promise;
  const previousDelete = f.workflow.removeBox(box("first"));
  f.account("owner-b");
  f.adapters.client.listBoxes = async () => [box("next-owner-box")];
  await f.workflow.loadBoxes();
  await f.workflow.openBox(box("next-owner-box"));
  deletion.resolve();
  await previousDelete;
  assert.equal(f.state.selectedId, "next-owner-box");
  assert.deepEqual(
    f.state.boxes.map((item) => item.id),
    ["next-owner-box"],
  );
});

for (const available of [false, true]) {
  test(`missing session distinguishes local browser access from account service ${available}`, async () => {
    const f = fixture();
    f.account("owner-a", available);
    f.adapters.client.listBoxes = async () => {
      throw new RepliesHttpError(401, "Unauthorized");
    };
    await f.workflow.loadBoxes();
    assert.equal(f.state.emptySession, !available);
    assert.equal(f.state.requiresSignIn, available);
    assert.equal(f.state.message, null);
    assert.equal(f.state.busy, false);
  });
}

test("disposal aborts the request and prevents every late view update", async () => {
  const f = fixture();
  const pending = deferred();
  const entered = deferred();
  let signal;
  f.adapters.client.listBoxes = (value) => {
    signal = value;
    entered.resolve();
    return pending.promise;
  };
  const request = f.workflow.loadBoxes();
  await entered.promise;
  f.workflow.dispose();
  const count = f.changes.length;
  pending.resolve([box("late")]);
  await request;
  await f.workflow.loadBoxes();
  assert.equal(signal.aborted, true);
  assert.equal(f.changes.length, count);
});

test("Back waits for a pending delete so the server result removes the cached box", async () => {
  const f = fixture();
  await f.workflow.loadBoxes();
  await f.workflow.openBox(box("first"));
  const pending = deferred();
  let signal;
  let deletions = 0;
  f.adapters.client.deleteBox = (_id, value) => {
    deletions++;
    signal = value;
    return pending.promise;
  };
  const deletion = f.workflow.removeBox(box("first"));
  assert.equal(f.state.deleting, true);
  f.workflow.back();
  await f.workflow.openBox(box("second"));
  await f.workflow.removeBox(box("first"));
  assert.equal(f.state.selectedId, "first");
  assert.equal(f.state.busy, true);
  assert.equal(
    signal.aborted,
    false,
    "Navigation must not lose a potentially committed deletion",
  );
  assert.equal(deletions, 1);
  pending.resolve();
  await deletion;
  assert.deepEqual(
    f.state.boxes.map((item) => item.id),
    ["second"],
  );
  assert.equal(f.state.selectedId, null);
  assert.equal(f.state.busy, false);
  assert.equal(f.state.deleting, false);
});

test("failed deletion restores Back navigation and retains the box for retry", async () => {
  const f = fixture();
  await f.workflow.loadBoxes();
  await f.workflow.openBox(box("first"));
  const pending = deferred();
  f.adapters.client.deleteBox = async () => {
    await pending.promise;
    throw new Error("The deletion failed");
  };
  const deletion = f.workflow.removeBox(box("first"));
  f.workflow.back();
  pending.resolve();
  await deletion;
  assert.equal(f.state.deleting, false);
  assert.equal(f.state.selectedId, "first");
  assert.equal(f.state.boxes.length, 2);
  assert.equal(f.state.message, "Couldn’t delete this box. Try again.");
  f.workflow.back();
  assert.equal(f.state.selectedId, null);
  assert.equal(f.state.busy, false);
});
