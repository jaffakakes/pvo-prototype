import { validPublicationId } from "../../../server/identity.js";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "../../../server/http.js";
import {
  REPLY_BOX_LIFETIME_MS,
  MAX_BOXES_PER_OWNER,
  MAX_REPLIES_PER_BOX,
  MAX_REPLIES_PER_BOX_DAY,
  MAX_REPLIES_PER_BOX_MINUTE,
} from "../../../server/replies/limits.js";

// A local beta has one private file, so also bound its total size across sessions.
const MAX_TOTAL_BOXES = 200;

async function readStoredBoxes(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(source);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (box) =>
        !validPublicationId(box?.id ?? "") ||
        typeof box.owner !== "string" ||
        !Number.isSafeInteger(box.expiresAt) ||
        !Array.isArray(box.replies),
    )
  )
    throw new Error("The local reply-box store is invalid.");
  return parsed;
}

function publicBox(box, origin, withCount = false) {
  return {
    id: box.id,
    url: `${origin}/api/reply-boxes/${box.id}/replies`,
    title: box.title,
    ...(withCount
      ? { createdAt: box.createdAt, count: box.replies.length }
      : {}),
  };
}

function freshBoxes(boxes, now) {
  return boxes.filter((box) => box.expiresAt > now);
}

/** Own the private on-disk store and serialize quota checks with atomic writes. */
export async function createLocalReplyRepository({
  directory,
  now = Date.now,
}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "reply-boxes.json");
  let boxes = await readStoredBoxes(path);
  let writes = Promise.resolve();

  function mutate(change) {
    const pending = writes.then(async () => {
      const next = structuredClone(freshBoxes(boxes, now()));
      const result = change(next);
      const temporary = join(
        directory,
        `.reply-boxes-${randomBytes(8).toString("hex")}.tmp`,
      );
      try {
        await writeFile(temporary, JSON.stringify(next), {
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      boxes = next;
      return result;
    });
    writes = pending.catch(() => {});
    return pending;
  }

  if (freshBoxes(boxes, now()).length !== boxes.length) await mutate(() => {});
  const cleanup = setInterval(
    () => {
      if (freshBoxes(boxes, now()).length !== boxes.length)
        void mutate(() => {}).catch((error) =>
          console.error("Local reply-box cleanup failed:", error),
        );
    },
    60 * 60 * 1000,
  );
  cleanup.unref();

  function create(owner, title, origin) {
    return mutate((next) => {
      if (
        next.length >= MAX_TOTAL_BOXES ||
        next.filter((item) => item.owner === owner).length >=
          MAX_BOXES_PER_OWNER
      )
        throw new HttpError(429, "The reply-box limit has been reached.");
      const timestamp = now();
      const box = {
        id: randomBytes(16).toString("base64url"),
        owner,
        title,
        createdAt: new Date(timestamp).toISOString(),
        expiresAt: timestamp + REPLY_BOX_LIFETIME_MS,
        replies: [],
      };
      next.push(box);
      return publicBox(box, origin);
    });
  }

  function list(owner, origin) {
    return freshBoxes(boxes, now())
      .filter((box) => box.owner === owner)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((box) => publicBox(box, origin, true));
  }

  function owned(id, owner) {
    const box = freshBoxes(boxes, now()).find(
      (item) => item.id === id && item.owner === owner,
    );
    if (!box) throw new HttpError(404, "This reply box is unavailable.");
    return box;
  }

  function replies(id, owner) {
    return [...owned(id, owner).replies].reverse();
  }

  function submit(id, answers) {
    return mutate((next) => {
      const box = next.find((item) => item.id === id);
      if (!box) throw new HttpError(404, "This reply box is unavailable.");
      const timestamp = now();
      const recentDay = box.replies.filter(
        (reply) => Date.parse(reply.createdAt) >= timestamp - 86_400_000,
      ).length;
      const recentMinute = box.replies.filter(
        (reply) => Date.parse(reply.createdAt) >= timestamp - 60_000,
      ).length;
      if (
        box.replies.length >= MAX_REPLIES_PER_BOX ||
        recentDay >= MAX_REPLIES_PER_BOX_DAY ||
        recentMinute >= MAX_REPLIES_PER_BOX_MINUTE
      )
        throw new HttpError(
          429,
          "This reply box is receiving too many messages. Try again later.",
        );
      box.replies.push({
        id: randomBytes(16).toString("base64url"),
        answers,
        createdAt: new Date(timestamp).toISOString(),
      });
    });
  }

  function remove(id, owner) {
    return mutate((next) => {
      const index = next.findIndex(
        (box) => box.id === id && box.owner === owner,
      );
      // Ownership and expiry must still hold when this serialized write begins.
      // Another queued deletion or expiry pruning may have removed the box.
      if (index < 0) throw new HttpError(404, "This reply box is unavailable.");
      next.splice(index, 1);
    });
  }

  async function close() {
    clearInterval(cleanup);
    await writes;
  }
  return { create, list, owned, replies, submit, remove, close };
}
