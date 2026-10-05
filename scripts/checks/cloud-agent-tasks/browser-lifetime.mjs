import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  taskFixture,
  ORIGIN,
  path,
} from "../../../tests/assistant-task-server/helpers.mjs";
import { input, question } from "../../../tests/assistant-tasks/fixtures.mjs";

let started = false;
let release;
const pending = new Promise((resolve) => {
  release = resolve;
});
const fixture = await taskFixture({
  planner: async () => {
    started = true;
    await pending;
    return Response.json({ kind: "ask", question: question() });
  },
});
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

async function open() {
  const context = await browser.newContext();
  const [name, value] = fixture.cookie.split("=");
  await context.addCookies([
    {
      name,
      value,
      url: ORIGIN,
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: "<title>Saved task lifetime check</title><main>Task test</main>",
      });
    const response = await fixture.request(url.pathname + url.search, {
      method: request.method(),
      session: request.headers().cookie || null,
      ...(request.postData() ? { body: request.postDataJSON() } : {}),
      headers: { Origin: request.headers().origin || ORIGIN },
    });
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    });
  });
  await page.goto(ORIGIN);
  return { page, context };
}

try {
  const first = await open();
  const project = (await fixture.project()).body.project.id;
  const created = await first.page.evaluate(
    async (body) =>
      (
        await fetch("/api/assistant/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json(),
    { ...input(), projectId: project },
  );
  assert.ok(created.task?.id);
  for (let index = 0; !started && index < 30; index++) await delay(10);
  assert.ok(
    started,
    "Server alarm started the step while the creating request was already finished",
  );
  await first.context.close();
  release();
  let saved;
  for (let index = 0; index < 100; index++) {
    saved = (await fixture.request(path(created.task))).body.task;
    if (saved.state === "waiting_for_answer") break;
    await delay(20);
  }
  assert.equal(saved.state, "waiting_for_answer");
  const second = await open();
  const restored = await second.page.evaluate(
    async (id) => (await fetch(`/api/assistant/tasks/${id}`)).json(),
    created.task.id,
  );
  assert.equal(restored.task.id, created.task.id);
  assert.equal(restored.task.questions[0].prompt, "Which day?");
  assert.equal(restored.task.usage.modelTurns, 1);
  await second.context.close();
  console.log(
    "Browser closed during an active server step; reopening recovered the same saved question and task.",
  );
} finally {
  release();
  await browser.close();
  await fixture.close();
}
