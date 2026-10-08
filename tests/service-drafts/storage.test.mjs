import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  taskFixture,
  expectStatus,
} from "../assistant-task-server/helpers.mjs";
import {
  hosted,
  control,
  version,
  status,
} from "../service-actions/helpers.mjs";

const create = async (f) => {
  const project = await f.project();
  expectStatus(project, 200);
  const input = {
    actionId: randomUUID(),
    projectId: project.body.project.id,
    description: "My Container",
  };
  const result = await f.request("/api/services", { body: input });
  expectStatus(result, 200);
  return {
    input,
    draft: result.body.draft,
    path: `/api/services/${result.body.draft.identity.serviceId}/draft`,
  };
};
const edit = (draft, source = "not valid JavaScript yet") => ({
  actionId: randomUUID(),
  expectedRevision: draft.revision,
  content: {
    ...draft.content,
    files: [{ path: "src/main.mjs", content: source }],
  },
});

test("unfinished manual draft survives actual storage restart, exact replay, conflict and account boundaries without compute", async () => {
  let starts = 0;
  const f = await taskFixture({
    services: true,
    workspaces: true,
    workspaceEffects: async () => {
      starts++;
      throw new Error("Editing cannot start compute");
    },
  });
  try {
    const c = await create(f),
      command = edit(c.draft);
    const save = await f.request(c.path, { body: command });
    expectStatus(save, 200);
    assert.equal(save.body.draft.revision, 1);
    await f.restart();
    const replay = await f.request(c.path, { body: command });
    expectStatus(replay, 200);
    assert.deepEqual(replay.body, save.body);
    expectStatus(
      await f.request(c.path, {
        body: {
          ...command,
          content: { ...command.content, description: "Different" },
        },
      }),
      409,
    );
    expectStatus(
      await f.request(c.path, { body: edit(c.draft, "stale AI change") }),
      409,
    );
    const read = await f.request(c.path);
    expectStatus(read, 200);
    assert.equal(
      read.body.content.files[0].content,
      "not valid JavaScript yet",
    );
    expectStatus(await f.request(c.path, { session: f.otherCookie }), 404);
    expectStatus(await f.request(c.path, { session: null }), 401);
    expectStatus(
      await f.request(c.path, {
        body: edit(read.body),
        headers: { Origin: "https://other.example" },
      }),
      403,
    );
    expectStatus(await f.request("/api/services", { body: c.input }), 200);
    expectStatus(
      await f.request("/api/services", {
        body: { ...c.input, description: "Reused ID" },
      }),
      409,
    );
    expectStatus(
      await f.request("/api/services", {
        body: { ...c.input, actionId: randomUUID(), projectId: "not-owned" },
      }),
      404,
    );
    const list = await f.request("/api/services");
    expectStatus(list, 200);
    assert.equal(list.body.services.length, 1);
    assert.equal(list.body.services[0].summary.service.liveReleaseId, null);
    assert.equal(starts, 0);
  } finally {
    await f.close();
  }
});

test("concurrent authors preserve one newer revision; evicted receipts cannot apply an old save again", async () => {
  const f = await taskFixture({ services: true });
  try {
    const c = await create(f);
    const commands = [edit(c.draft, "manual"), edit(c.draft, "AI")];
    const saves = await Promise.all(
      commands.map((body) => f.request(c.path, { body })),
    );
    assert.deepEqual(saves.map((x) => x.status).sort(), [200, 409]);
    let draft = saves.find((x) => x.status === 200).body.draft;
    const original = commands[saves.findIndex((x) => x.status === 200)];
    for (let i = 0; i < 17; i++) {
      const saved = await f.request(c.path, {
        body: edit(draft, `revision ${i}`),
      });
      expectStatus(saved, 200);
      draft = saved.body.draft;
    }
    expectStatus(await f.request(c.path, { body: original }), 409);
    assert.equal((await f.request(c.path)).body.revision, 18);
    expectStatus(
      await f.request(c.path, {
        body: {
          ...edit(draft),
          content: {
            ...draft.content,
            files: [{ path: "src/../../escape.mjs", content: "x" }],
          },
        },
      }),
      400,
    );
  } finally {
    await f.close();
  }
});

test("published source initializes one draft, later versions preserve edits, deletion removes draft and fences late saves", async () => {
  const f = await taskFixture({ services: true });
  try {
    const service = await hosted(f),
      path = `/api/services/${service.identity.serviceId}/draft`;
    const initial = await f.request(path);
    expectStatus(initial, 200);
    assert.ok(initial.body.content.files.length > 0);
    expectStatus(await control(f, service, "activate"), 200);
    expectStatus(
      await f.request(path, {
        body: edit(initial.body, "unfinished local edit"),
      }),
      200,
    );
    await version(f, service);
    const saved = await f.request(path);
    assert.equal(saved.body.revision, 1);
    assert.equal(saved.body.content.files[0].content, "unfinished local edit");
    assert.equal(
      (await status(f, service)).body.summary.service.liveReleaseId,
      service.identity.resourceId,
    );
    expectStatus(await control(f, service, "delete"), 200);
    expectStatus(await f.request(path), 404);
    expectStatus(await f.request(path, { body: edit(saved.body) }), 404);
  } finally {
    await f.close();
  }
});
