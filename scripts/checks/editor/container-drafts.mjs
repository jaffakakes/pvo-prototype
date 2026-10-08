import { nodeLibraryIds } from "../../../packages/pvo-assistant/services/index.js";
import {
  packageFor,
  dinnerAgreement,
} from "../../../tests/service-validation/fixtures.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  taskFixture,
  expectStatus,
} from "../../../tests/assistant-task-server/helpers.mjs";
import { ORIGIN } from "../../../tests/assistant-task-server/helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";
const f = await taskFixture({
  services: true,
  workspaces: true,
  workspaceEffects: async () =>
    Response.json({ exitCode: 0, stdout: "Selected tests passed" }),
  planner: async (request) => {
    const task = await request.json(),
      draft = task.draftContext;
    if (!task.questions.length)
      return Response.json({
        kind: "ask",
        prompt: "Which comment should I add?",
        choices: ["Reviewed together"],
      });
    if (draft.revision === 4) return Response.json({ kind: "done" });
    if (!draft.read)
      return Response.json({ kind: "read", path: "src/main.mjs", offset: 0 });
    return Response.json({
      kind: "write",
      libraries: nodeLibraryIds(draft.metadata.dependencies),
      expectedRevision: draft.revision,
      files: [
        {
          path: "src/main.mjs",
          content: draft.read.content + "\n// Reviewed together",
        },
      ],
      entrypoint: draft.metadata.entrypoint,
      tests: draft.metadata.tests,
      agreementJson: JSON.stringify(draft.metadata.agreement),
    });
  },
});
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
let cookie = f.cookie,
  lost = true,
  lostTask = true,
  lostPublish = true,
  page;
const saves = [],
  errors = [];
try {
  await installAssistantAvailabilityFixture(context);
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  await context.route("**/api/auth/session", async (route) => {
    const r = await f.request("/api/auth/session", { session: cookie });
    await route.fulfill({ status: r.status, json: r.body });
  });
  await context.route(
    /\/api\/(services(\/.*)?|assistant\/(projects|tasks(\/.*)?))$/,
    async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        body = req.postData() ? req.postDataJSON() : undefined;
      let r;
      try {
        r = await f.request(url.pathname, {
          method: req.method(),
          body,
          session: cookie,
          headers: { Origin: ORIGIN },
        });
      } catch {
        await route.fulfill({
          status: 503,
          json: { error: "The fixture server is restarting" },
        });
        return;
      }
      if (url.pathname === "/api/assistant/tasks" && body && lostTask) {
        lostTask = false;
        expectStatus(r, 201);
        await route.fulfill({
          status: 503,
          json: { error: "Lost task creation reply" },
        });
        return;
      }
      if (url.pathname.endsWith("/draft") && body) {
        saves.push(body);
        if (lost) {
          lost = false;
          expectStatus(r, 200);
          await route.fulfill({
            status: 503,
            json: { error: "Lost committed save reply" },
          });
          return;
        }
      }
      if (url.pathname.endsWith("/activate") && body && lostPublish) {
        lostPublish = false;
        expectStatus(r, 200);
        await route.fulfill({
          status: 503,
          json: { error: "Lost publication reply" },
        });
        return;
      }
      await route.fulfill({ status: r.status, json: r.body });
    },
  );
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let initial = true;
  async function open() {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5319/");
    if (initial) {
      await page
        .getByRole("button", { name: "Blank project", exact: true })
        .click();
      initial = false;
    }
    await page.waitForFunction(
      async () =>
        (await import("/src/app/projectAutosave.ts")).getProjectStorageStatus()
          .phase === "ready",
    );
    await page.locator("#root[inert]").waitFor({ state: "hidden" });
    await page.evaluate(async () => {
      await (
        await import("/src/state/auth/authGateStore.ts")
      ).refreshAccountSession();
    });
    if (page.viewportSize().width >= 900) {
      await page
        .getByRole("button", { name: "Project settings", exact: true })
        .click();
      await page
        .getByRole("button", { name: "More settings", exact: true })
        .click();
    } else {
      await page
        .locator("header")
        .getByRole("button", { name: "More", exact: true })
        .click();
    }
    await page
      .getByRole("button", { name: "Open Containers", exact: true })
      .click();
  }
  await open();
  await page.getByLabel("New Container name").fill("Booking service");
  await page
    .getByRole("button", { name: "Create Container", exact: true })
    .click();
  await page.getByText("Saved draft · revision 0", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  const code = page.getByRole("textbox", {
    name: "Code for src/main.mjs",
    exact: true,
  });
  await code.fill("// unfinished manual draft");
  await page
    .getByRole("checkbox", { name: "nanoid 5.1.6", exact: true })
    .check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .waitFor();
  // Pending is shown before dispatch. Restart only after the server committed
  // and the deliberately lost response reached the client.
  await page
    .getByText("The save could not be confirmed. Retry the saved action.", {
      exact: true,
    })
    .waitFor();
  await f.restart();
  await open();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  assert.equal(await code.inputValue(), "// unfinished manual draft");
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await page.getByText("Saved draft · revision 1", { exact: true }).waitFor();
  assert.deepEqual(saves[1], saves[0]);
  assert.equal(saves[1].content.dependencies[0].version, "5.1.6");
  assert.equal(
    await page
      .getByRole("checkbox", { name: "nanoid 5.1.6", exact: true })
      .isChecked(),
    true,
  );
  await code.fill("// local work survives reload");
  await open();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  assert.equal(await code.inputValue(), "// local work survives reload");
  const list = await f.request("/api/services"),
    id = list.body.services[0].metadata.identity.serviceId;
  const remote = await f.request(`/api/services/${id}/draft`);
  const other = {
    actionId: "concurrent-ai-save",
    expectedRevision: remote.body.revision,
    content: {
      ...remote.body.content,
      files: [{ path: "src/main.mjs", content: "// another author" }],
    },
  };
  expectStatus(
    await f.request(`/api/services/${id}/draft`, { body: other }),
    200,
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Save my edits over the reviewed revision",
      exact: true,
    })
    .waitFor();
  assert.equal(await code.inputValue(), "// local work survives reload");
  await page
    .getByRole("button", {
      name: "Save my edits over the reviewed revision",
      exact: true,
    })
    .click();
  await page.getByText("Saved draft · revision 3", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Check draft fields on device", exact: true })
    .click();
  await page
    .getByText("Draft fields checked on this device.", { exact: false })
    .waitFor();
  await page
    .getByLabel("Changes to this Container")
    .fill("Add a comment to my saved draft");
  await page
    .getByRole("button", { name: "Continue with AI", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry saved task", exact: true })
    .waitFor();
  await f.restart();
  await open();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  await page
    .getByLabel("Which comment should I add?")
    .fill("Reviewed together");
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await page
    .getByText("Changes are saved. Refresh the code", { exact: false })
    .waitFor();
  await code.fill("// local edit while AI finishes");
  await page
    .getByRole("button", { name: "Refresh saved code", exact: true })
    .click();
  await page
    .getByText("A newer revision is saved.", { exact: false })
    .waitFor();
  assert.equal(await code.inputValue(), "// local edit while AI finishes");
  await page
    .getByRole("button", {
      name: "Discard local edits and use saved draft",
      exact: true,
    })
    .click();
  assert.equal(
    await code.inputValue(),
    "// local work survives reload\n// Reviewed together",
  );
  const tasks = await f.request(
    `/api/assistant/tasks?project=${remote.body.identity.projectId}`,
  );
  expectStatus(tasks, 200);
  assert.equal(tasks.body.tasks.length, 1);
  assert.equal(tasks.body.tasks[0].state, "ready");
  assert.equal(tasks.body.tasks[0].usage.toolCalls, 0);
  const fixture = packageFor();
  expectStatus(
    await f.request(`/api/services/${id}/draft`, {
      body: {
        actionId: "manual-test-source",
        expectedRevision: 4,
        content: {
          ...other.content,
          files: fixture.files,
          entrypoint: fixture.entrypoint,
          tests: fixture.tests,
          agreement: dinnerAgreement(),
        },
      },
    }),
    200,
  );
  await page
    .getByRole("button", { name: "Refresh saved code", exact: true })
    .click();
  await page.getByText("Saved draft · revision 5", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Test saved draft", exact: true })
    .click();
  await page
    .getByText("Draft revision 5 passed its checks.", { exact: false })
    .waitFor();
  await page.getByText("Test results", { exact: true }).click();
  await page.getByText("Independent checks: passed", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Refresh Containers", exact: true })
    .click();
  const publicationReply = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/activate") &&
      response.status() === 503,
  );
  await page
    .getByRole("button", { name: "Publish checked version", exact: true })
    .click();
  await publicationReply;
  assert.equal(
    lostPublish,
    false,
    "The injected loss follows a confirmed commit",
  );
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .waitFor();
  await f.restart();
  await open();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await page.getByText("Status: active", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  await page
    .getByLabel("Code for src/service.mjs", { exact: true })
    .fill("export const execute = () => ({ result:null, state:null });");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Saved draft · revision 6", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Test saved draft", exact: true })
    .click();
  await page
    .getByText("The saved draft did not pass its tests.", { exact: false })
    .waitFor();
  await page.getByText("Test results", { exact: true }).click();
  await page.getByText("Independent checks: failed", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Refresh Containers", exact: true })
    .click();
  await page.getByText("Status: active", { exact: true }).waitFor();
  const checkedTasks = (
    await f.request(
      `/api/assistant/tasks?project=${remote.body.identity.projectId}`,
    )
  ).body.tasks;
  const manual = checkedTasks.filter(
    (t) => t.input.context.container.mode === "test",
  );
  assert.equal(manual.length, 2);
  assert.ok(manual.every((t) => t.usage.modelTurns === 0));
  assert.equal(
    (await f.request(`/api/services/${id}`)).body.summary.releases.filter(
      (r) => r.state !== "deleted",
    ).length,
    1,
  );
  await page
    .getByText("Independent checks: failed", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-containers-desktop.png" });
  await page
    .getByRole("group", { name: "Libraries", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-libraries-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  await page.getByText("Test results", { exact: true }).click();
  await page
    .getByText("Independent checks: failed", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-containers-phone.png" });
  await page
    .getByRole("group", { name: "Libraries", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-libraries-phone.png" });
  await page.getByRole("button", { name: "Stop task", exact: true }).click();
  await page
    .getByText("Work on this draft has stopped.", { exact: false })
    .waitFor();
  const stopped = (
    await f.request(
      `/api/assistant/tasks?project=${remote.body.identity.projectId}`,
    )
  ).body.tasks.find((t) => t.state === "stopped");
  await f.control({ action: "time", now: stopped.expiresAt + 1 });
  await f.control({ action: "sweep" });
  await open();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear expired task", exact: true })
    .click();
  await page.getByLabel("Changes to this Container").waitFor();
  assert.equal(
    await page
      .getByLabel("Code for src/service.mjs", { exact: true })
      .inputValue(),
    "export const execute = () => ({ result:null, state:null });",
  );
  cookie = f.otherCookie;
  await page.evaluate(async () => {
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
  });
  await page.getByText("No Containers yet.", { exact: false }).waitFor();
  assert.equal(
    await page.getByLabel("Code for src/service.mjs", { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Containers: creation, manual editing, lost committed reply/exact replay, real host restart, local reload, concurrent-author conflict/reapply, device checks, AI question/reload/answer, lost task creation recovery, same-draft editing, manual tests, independent rejection, publish replay, live preservation, expired-task recovery and account isolation passed.",
  );
} catch (error) {
  console.error("Browser errors:", errors);
  await page
    ?.screenshot({ path: "/tmp/restyle-containers-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
  await f.close();
}
