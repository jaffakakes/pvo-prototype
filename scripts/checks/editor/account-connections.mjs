import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  taskFixture,
  ORIGIN,
} from "../../../tests/assistant-task-server/helpers.mjs";
import {
  provider,
  setup,
  TOKEN,
  KEY,
} from "../../../tests/account-connections/helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

const api = provider();
let saved;
const fixture = await taskFixture({
  workspaces: true,
  productionLeases: true,
  connectionKey: KEY,
  connectionFetch: api.fetch,
  planner: async (request) => {
    const task = await request.json();
    if (task.stepId === "plan")
      return Response.json({ kind: "checkpoint", stepId: "build" });
    if (!task.questions.length)
      return Response.json({
        kind: "connect_account",
        setup,
        purpose: "Read issues for your requested view.",
      });
    return Response.json({
      kind: "ask",
      prompt:
        "The connection is saved. Keep this task until Container account access is available?",
      choices: ["Keep saved"],
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
const errors = [];
try {
  await installAssistantAvailabilityFixture(context);
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  await context.route("**/api/auth/session", async (route) => {
    const result = await fixture.request("/api/auth/session");
    await route.fulfill({ status: result.status, json: result.body });
  });
  await context.route(
    /\/api\/(assistant\/(projects|tasks)(\/.*)?|account-connections(\/[^?]*)?)(\?.*)?$/,
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const result = await fixture.request(url.pathname + url.search, {
        method: request.method(),
        body: request.postData() ? request.postDataJSON() : undefined,
        headers: {
          Origin: ORIGIN,
          "X-Restyle-Owner": request.headers()["x-restyle-owner"] ?? "",
        },
      });
      if (
        url.pathname === "/api/assistant/tasks" &&
        request.method() === "POST"
      )
        saved = result.body.task;
      await route.fulfill({ status: result.status, json: result.body });
    },
  );
  await context.route("**/api/assistant/turn", (route) =>
    route.fulfill({
      json: {
        message: "Starting saved work",
        operations: [],
        observations: [],
        cloudTask: {
          examples: [
            {
              id: "issues",
              input: "Open repository view",
              expected: "Show only the requested repository's issues",
            },
          ],
        },
      },
    }),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5321/");
  await page.evaluate(async () => {
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
    window.connectionProbe = {
      storage: await import("/src/app/projectAutosave.ts"),
      capture: (await import("/src/state/captureStore.ts")).useCapture,
    };
  });
  await page.waitForFunction(
    () =>
      window.connectionProbe.storage.getProjectStorageStatus().phase ===
      "ready",
  );
  await page.evaluate(async () =>
    (
      await import("/src/features/create-project/projectCommands.ts")
    ).createProject({
      name: "Private account setup",
      ratio: "9:16",
      clips: [],
    }),
  );
  await page.locator("[data-assistant-orb]").click();
  await page
    .getByRole("textbox", { name: "Describe a change" })
    .fill("Build a view of issues from octocat/private-work");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  const key = page.getByLabel("Private access token", { exact: true });
  await key.waitFor();
  assert.equal(await key.getAttribute("type"), "password");
  await page.screenshot({ path: "/tmp/restyle-2b-connection-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-assistant-thread][data-variant="phone"]').waitFor();
  await page
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  await key.waitFor();
  await page.screenshot({ path: "/tmp/restyle-2b-connection-form-phone.png" });
  await key.fill(TOKEN);
  await page
    .getByRole("button", { name: "Connect and continue", exact: true })
    .click();
  const prompt =
    "The connection is saved. Keep this task until Container account access is available?";
  await page.getByRole("textbox", { name: prompt, exact: true }).waitFor();
  let task = (await fixture.request(`/api/assistant/tasks/${saved.id}`)).body
    .task;
  assert.equal(task.questions[0].answer.connectionId.length > 0, true);
  assert.equal(JSON.stringify(task).includes(TOKEN), false);
  assert.equal(
    await page.evaluate(
      (token) =>
        JSON.stringify(localStorage).includes(token) ||
        JSON.stringify(sessionStorage).includes(token),
      TOKEN,
    ),
    false,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await page.getByRole("textbox", { name: prompt, exact: true }).waitFor();
  task = (await fixture.request(`/api/assistant/tasks/${saved.id}`)).body.task;
  assert.equal(task.questions.length, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-assistant-thread][data-variant="phone"]').waitFor();
  await page.getByRole("textbox", { name: prompt, exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/restyle-2b-connection-phone.png" });
  await page
    .getByRole("button", { name: "Close Restyle thread", exact: true })
    .click();
  await page
    .getByRole("banner")
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Manage connections", exact: true })
    .click();
  const manager = page.getByRole("region", {
    name: "Account connections",
    exact: true,
  });
  await manager
    .getByText("octocat · Connected · read only", { exact: true })
    .waitFor();
  api.reject = true;
  await manager
    .getByRole("button", { name: "Check access", exact: true })
    .click();
  await manager.getByRole("alert").waitFor();
  await manager
    .getByRole("button", { name: "Refresh connections", exact: true })
    .click();
  await manager
    .getByText("octocat · Access needs attention · reconnect", { exact: true })
    .waitFor();
  api.reject = false;
  await manager.getByRole("button", { name: "Reconnect", exact: true }).click();
  await manager.getByLabel("Private access token", { exact: true }).fill(TOKEN);
  await manager
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await manager
    .getByText("octocat · Connected · read only", { exact: true })
    .waitFor();
  await manager
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await manager.getByText("octocat · Disconnected", { exact: true }).waitFor();
  const secretRows = (await fixture.control({ action: "connection-storage" }))
    .body;
  assert.equal(secretRows.length, 1);
  assert.equal(secretRows[0].credential, null);
  await manager.getByRole("button", { name: "Reconnect", exact: true }).click();
  await manager.getByLabel("Private access token", { exact: true }).fill(TOKEN);
  await page.evaluate(async () => {
    const { useAuthGate } = await import("/src/state/auth/authGateStore.ts");
    useAuthGate.setState({ user: { id: "other-owner", name: "Other" } });
  });
  await page.waitForFunction(
    () => !document.querySelector('input[type="password"]'),
  );
  assert.equal(
    await page.getByText(setup.repository, { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      taskReferenceSaved: true,
      reloadRetainsAnswer: true,
      privateForm: true,
      viewports: [1440, 390],
      provider: "controlled",
      management: [
        "expired",
        "reconnected",
        "disconnected",
        "account-switch-clears-key",
      ],
    }),
  );
} finally {
  await context.close();
  await browser.close();
  await fixture.close();
}
