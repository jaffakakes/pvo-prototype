import assert from "node:assert/strict";
import test from "node:test";
import {
  taskFixture,
  saved,
  current,
  planner,
  validation,
  deferred,
} from "./task.helpers.mjs";
import { NOW } from "../assistant-task-server/helpers.mjs";

test(
  "a slow resource step keeps its claim beyond a model turn and saves the completed validation",
  { timeout: 25000 },
  async () => {
    const entered = deferred(),
      release = deferred();
    const modelClaims = [];
    let held = false;
    const f = await taskFixture({
      clock: NOW,
      services: true,
      workspaces: true,
      productionLeases: true,
      planner: planner({
        observe: (task) =>
          modelClaims.push(task.claim.expiresAt - task.claim.claimedAt),
      }),
      validationControl: async (request) => {
        if ((await request.json()).phase === "before" && !held) {
          held = true;
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    let progressing;
    try {
      const task = await saved(f);
      progressing = (async () => {
        for (let i = 0; i < 30; i++) {
          await f.control({ action: "sweep" });
          const state = await current(f, task);
          if (state.state === "waiting_for_answer") return state;
        }
        throw new Error("Validation did not finish");
      })();
      await entered.promise;
      const active = await current(f, task);
      assert.equal(active.stepId, "validate");
      assert.equal(active.claim.expiresAt - active.claim.claimedAt, 330000);
      await f.control({ action: "time", now: NOW + 70000 });
      release.resolve();
      assert.equal((await progressing).stepId, "attach");
      assert.equal(
        (await validation(f, task)).artifacts[0].report.status,
        "passed",
      );
      assert.ok(
        modelClaims.length > 0 && modelClaims.every((value) => value === 75000),
      );
    } finally {
      release.resolve();
      await progressing?.catch(() => {});
      await f.close();
    }
  },
);
