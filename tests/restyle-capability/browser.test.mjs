import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskFixture } from "../assistant-task-server/helpers.mjs";
import { createDurableBrowser } from "../../scripts/checks/restyle-capability/durable-browser.mjs";

test(
  "durable browser evaluation creates its actual saved task from a persisted editor project",
  {
    skip: process.env.RESTYLE_BROWSER_PREFLIGHT !== "1",
    timeout: 90000,
  },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "restyle-browser-preflight-"),
    );
    const fixture = await taskFixture({
      services: true,
      clock: Date.now(),
      planner: async () =>
        Response.json({
          kind: "ask",
          question: {
            id: "preflight",
            revision: 0,
            prompt: "Controlled preflight stop.",
            choices: [],
            answer: null,
          },
        }),
    });
    let creator;
    try {
      creator = await createDurableBrowser(
        fixture,
        "Build a shared guestbook. Save name and message and show the latest three after submitting.",
        directory,
      );
      assert.ok(creator.task.input.context.fingerprint);
      assert.notEqual(creator.task.input.context.fingerprint, "100-abc-def");
      assert.deepEqual(creator.errors, []);
    } finally {
      if (creator) await creator.close();
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
