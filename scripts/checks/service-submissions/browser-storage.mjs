import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { dinnerAgreement } from "../../../tests/service-packages/fixtures.mjs";

const origin = "https://submission-storage.example";
const profile = await mkdtemp(join(tmpdir(), "restyle-submission-browser-"));
const target = {
  origin,
  serviceId: "service-" + "a".repeat(64),
  releaseId: "release-" + "b".repeat(64),
  operation: dinnerAgreement().operations[0],
  mode: "public",
  ownerId: null,
};
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      'export { openServiceSubmissionStore, createServiceSubmissionClient } from "./packages/pvo-assistant/attachments/index.js";',
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "SubmissionCheck",
  platform: "browser",
});
let context;
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  await context.route(`${origin}/**`, async (route) => {
    const script = new URL(route.request().url()).pathname === "/check.js";
    await route.fulfill({
      contentType: script ? "application/javascript" : "text/html",
      body: script
        ? bundle.outputFiles[0].text
        : '<!doctype html><title>Submission storage acceptance</title><script src="/check.js"></script>',
    });
  });
}
async function open() {
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async (target) => {
    window.target = target;
    window.store = await SubmissionCheck.openServiceSubmissionStore();
    window.sent = [];
    window.behavior = "success";
    window.releases = [];
    window.client = SubmissionCheck.createServiceSubmissionClient({
      store: window.store,
      createId: () => crypto.randomUUID(),
      send: async (request) => {
        window.sent.push(request);
        if (window.behavior === "lost")
          throw new Error("Controlled lost response");
        if (window.behavior === "pending")
          await new Promise((resolve) => window.releases.push(resolve));
        return {
          actionId: JSON.parse(request.body).actionId,
          result: "accepted",
        };
      },
    });
    window.active = { isCurrent: () => true };
  }, target);
  return page;
}

try {
  await launch();
  let page = await open();
  const original = await page.evaluate(async () => {
    window.behavior = "lost";
    try {
      await client.submit("reload", target, { name: "Alice" }, active);
    } catch (error) {
      if (!error.message.includes("Controlled lost response")) throw error;
    }
    return { saved: await store.read("reload"), request: sent[0] };
  });
  assert.equal(original.saved.response, null);
  assert.match(original.saved.action.actionId, /^[a-f0-9-]{36}$/);
  await context.close(); // Close Chromium completely, preserving only its temporary profile.
  await launch();
  page = await open();
  assert.deepEqual(
    await page.evaluate(() => store.read("reload")),
    original.saved,
  );
  const recovered = await page.evaluate(async () => {
    let changed;
    try {
      await client.submit("reload", target, { name: "Bob" }, active);
    } catch (error) {
      changed = error.code;
    }
    const result = await client.retry("reload", target, active);
    await client.retry("reload", target, active);
    return { result, changed, sent };
  });
  assert.equal(recovered.changed, "submission_pending");
  assert.equal(recovered.sent.length, 1);
  assert.deepEqual(recovered.sent[0], original.request);
  assert.equal(recovered.result.response.result, "accepted");

  const other = await open();
  await Promise.all(
    [page, other].map((tab, index) =>
      tab.evaluate(
        (name) => {
          window.behavior = "pending";
          void client.submit("race", target, { name }, active).then(
            (value) => {
              window.outcome = { result: value };
            },
            (error) => {
              window.outcome = { error: error.code };
            },
          );
        },
        index ? "Bob" : "Alice",
      ),
    ),
  );
  for (const tab of [page, other])
    await tab.waitForFunction(
      () => window.outcome || window.releases.length === 1,
    );
  const racing = await Promise.all(
    [page, other].map((tab) =>
      tab.evaluate(() => ({
        outcome: window.outcome,
        held: window.releases.length,
      })),
    ),
  );
  assert.equal(
    racing.filter((item) => item.outcome?.error === "submission_pending")
      .length,
    1,
  );
  assert.equal(
    racing.reduce((total, item) => total + item.held, 0),
    1,
  );
  await Promise.all(
    [page, other].map((tab) =>
      tab.evaluate(() => window.releases.forEach((release) => release())),
    ),
  );
  for (const tab of [page, other])
    await tab.waitForFunction(() => window.outcome);
  const winner = await page.evaluate(() => store.read("race"));
  assert.equal(winner.response.result, "accepted");
  assert.deepEqual(await other.evaluate(() => store.read("race")), winner);

  const failed = await page.evaluate(async () => {
    const before = await store.read("race");
    let rollback = false;
    try {
      await store.update("race", () => {
        throw new Error("Controlled transaction failure");
      });
    } catch {
      rollback = true;
    }
    const after = await store.read("race");
    store.close();
    const calls = sent.length;
    let closed = false;
    try {
      await client.submit("closed", target, { name: "Alice" }, active);
    } catch {
      closed = true;
    }
    return { before, after, rollback, closed, calls, finalCalls: sent.length };
  });
  assert.equal(failed.rollback && failed.closed, true);
  assert.deepEqual(failed.before, failed.after);
  assert.equal(failed.calls, failed.finalCalls);
  await context.close();
  await launch();
  page = await open();
  assert.deepEqual(await page.evaluate(() => store.read("race")), winner);
  console.log(
    "Actual Chromium IndexedDB passed full browser restart, exact saved retry, cross-tab transaction exclusion, rollback, closed-storage no-dispatch and completed-result retention. Network responses were controlled; no service was called.",
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
