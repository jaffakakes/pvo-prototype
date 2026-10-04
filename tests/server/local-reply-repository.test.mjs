import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLocalReplyRepository } from "../../scripts/dev/reply-boxes/repository.mjs";
import {
  MAX_BOXES_PER_OWNER,
  MAX_REPLIES_PER_BOX_MINUTE,
} from "../../server/replies/limits.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "restyle-reply-store-test-"));
  let now = Date.UTC(2026, 9, 4);
  const boxes = await createLocalReplyRepository({ directory, now: () => now });
  t.after(async () => {
    await boxes.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    boxes,
    directory,
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}

test("local reply quotas are serialized and a rejected write does not block the next owner", async (t) => {
  const { boxes, directory } = await fixture(t);
  const attempts = await Promise.allSettled(
    Array.from({ length: MAX_BOXES_PER_OWNER + 3 }, (_, index) =>
      boxes.create("owner", `Box ${index}`, "http://localhost"),
    ),
  );
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    MAX_BOXES_PER_OWNER,
  );
  const failures = attempts.filter((attempt) => attempt.status === "rejected");
  assert.equal(failures.length, 3);
  assert.ok(failures.every((attempt) => attempt.reason.status === 429));
  const another = await boxes.create(
    "another-owner",
    "Still available",
    "http://localhost",
  );
  assert.equal(
    boxes.list("another-owner", "http://localhost")[0].id,
    another.id,
  );
  assert.throws(
    () => boxes.replies(another.id, "owner"),
    (error) => error.status === 404,
  );
  const path = join(directory, "reply-boxes.json");
  assert.equal(
    JSON.parse(await readFile(path, "utf8")).length,
    MAX_BOXES_PER_OWNER + 1,
  );
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("concurrent public replies observe the minute quota and resume when its window passes", async (t) => {
  const { boxes, advance } = await fixture(t);
  const box = await boxes.create("owner", "Feedback", "http://localhost");
  const attempts = await Promise.allSettled(
    Array.from({ length: MAX_REPLIES_PER_BOX_MINUTE + 1 }, (_, index) =>
      boxes.submit(box.id, { message: `Reply ${index}` }),
    ),
  );
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    MAX_REPLIES_PER_BOX_MINUTE,
  );
  assert.equal(
    attempts.find((attempt) => attempt.status === "rejected").reason.status,
    429,
  );
  assert.equal(
    boxes.replies(box.id, "owner").length,
    MAX_REPLIES_PER_BOX_MINUTE,
  );
  advance(60_001);
  await boxes.submit(box.id, { message: "After the window" });
  assert.equal(
    boxes.replies(box.id, "owner")[0].answers.message,
    "After the window",
  );
});
