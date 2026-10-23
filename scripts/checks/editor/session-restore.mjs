import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  installSupabaseFixture,
  fillEmailForm,
  supabaseUrl,
  publishableKey,
} from "./supabase-fixture.mjs";

// An isolated origin serves the built beta and changes only its worker revision.
const upstream = new URL(
  process.env.EDITOR_URL || "http://127.0.0.1:4173/editor/",
);
let revision = 0;
const server = createServer(async (request, response) => {
  try {
    const result = await fetch(new URL(request.url, upstream));
    const bytes = Buffer.from(await result.arrayBuffer());
    response.writeHead(result.status, {
      "Content-Type":
        result.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(
      request.url === "/editor/sw.js"
        ? Buffer.concat([bytes, Buffer.from(`\n// session-test-${revision}\n`)])
        : bytes,
    );
  } catch {
    response.writeHead(502).end();
  }
});
server.on("upgrade", (_request, socket) => socket.destroy());
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser({
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    serviceWorkers: "allow",
  });
  const provider = await installSupabaseFixture(context);
  let signedIn = false,
    exchanges = 0;
  let holdRenewal = null;
  let renewalStarted = () => {};
  const user = { id: "session-fixture", name: "Saved creator" };
  await context.route(`${origin}/api/auth/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value) => route.fulfill({ json: value });
    if (path === "/api/auth/session")
      return json({
        available: true,
        supabaseAvailable: true,
        supabaseUrl,
        supabasePublishableKey: publishableKey,
        user: signedIn ? user : null,
      });
    if (path === "/api/auth/supabase/exchange") {
      assert.equal(
        route.request().headers().authorization,
        `Bearer ${provider.session.access_token}`,
      );
      if (holdRenewal) {
        renewalStarted();
        await holdRenewal;
      }
      signedIn = true;
      exchanges++;
      return json({ user });
    }
    if (path === "/api/auth/logout") {
      signedIn = false;
      return json({ user: null });
    }
    throw new Error(`Unexpected auth path: ${path}`);
  });
  await context.route(`${origin}/api/account/profile`, (route) =>
    route.fulfill({
      json: { ...user, email: "saved@example.test", photo: null },
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(`${origin}/editor/`);
  await page
    .locator("input[type=file][accept*=video]")
    .first()
    .setInputFiles(
      new URL("../../../share/assets/preview.mp4", import.meta.url).pathname,
    );
  await page
    .getByRole("button", { name: /^(Open editor|Start editing)$/ })
    .click();
  await page.getByText(/^Saved in this browser(?: ·.*)?$/).waitFor();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = page.locator("dialog[data-auth-step]");
  await dialog
    .getByRole("button", { name: "Continue with email", exact: true })
    .click();
  await fillEmailForm(dialog, "saved@example.test");
  const avatar = page.getByRole("button", {
    name: "Account · Saved creator",
    exact: true,
  });
  await avatar.waitFor();
  assert.equal(exchanges, 1);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const readProject = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const opening = indexedDB.open("restyle-editor-project");
          opening.onsuccess = () => {
            const database = opening.result;
            const reading = database
              .transaction("checkpoints")
              .objectStore("checkpoints")
              .get("current");
            reading.onsuccess = () => {
              const record = reading.result;
              database.close();
              resolve(
                record && {
                  assetIds: record.assetIds,
                  scenes: record.project.scenes.map((scene) => ({
                    id: scene.id,
                    clips: scene.clips.map((clip) => clip.id),
                  })),
                },
              );
            };
          };
        }),
    );
  const beforeUpdate = await readProject();
  assert(beforeUpdate.assetIds.length > 0);
  signedIn = false; // Simulate the 15-minute Restyle cookie expiry.
  revision++;
  await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration()).update(),
  );
  await page.getByText("New beta release", { exact: true }).waitFor();
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await reloaded;
  await avatar.waitFor();
  assert.equal(
    exchanges,
    2,
    "Update must restore the previously accepted sign-in",
  );
  assert.deepEqual(
    await readProject(),
    beforeUpdate,
    "Update must retain project scenes and media",
  );
  const projectUrl = page.url();
  await page.getByText(/^Saved in this browser(?: ·.*)?$/).waitFor();

  // Expire the SDK access token as well, retaining its refresh token.
  signedIn = false;
  await page.evaluate(() => {
    const key = "restyle-auth-restyle-test";
    const session = JSON.parse(localStorage.getItem(key));
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(session));
  });
  await page.reload();
  await avatar.waitFor();
  assert.equal(provider.refreshCalls, 1);
  assert.equal(exchanges, 3);
  const savedProvider = await page.evaluate(() =>
    localStorage.getItem("restyle-auth-restyle-test"),
  );
  const other = await context.newPage();
  await other.goto(projectUrl);
  const otherAvatar = other.getByRole("button", {
    name: "Account · Saved creator",
    exact: true,
  });
  await otherAvatar.waitFor();
  let releaseRenewal;
  holdRenewal = new Promise((resolve) => {
    releaseRenewal = resolve;
  });
  const renewing = new Promise((resolve) => {
    renewalStarted = resolve;
  });
  signedIn = false;
  await page.reload();
  await renewing;
  await otherAvatar.click();
  await other.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await other.waitForFunction(
    () => localStorage.getItem("restyle-account-session") === null,
  );
  releaseRenewal();
  await other.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  await other.waitForFunction(
    () => localStorage.getItem("restyle-auth-restyle-test") === null,
  );
  assert.equal(
    signedIn,
    false,
    "sign-out in another tab must win over an in-flight renewal",
  );
  holdRenewal = null;
  await other.close();
  await page.reload();
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  assert.equal(exchanges, 4);
  // A lingering provider credential alone must not reverse explicit sign-out.
  await page.evaluate(
    (value) => localStorage.setItem("restyle-auth-restyle-test", value),
    savedProvider,
  );
  await page.reload();
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  assert.equal(exchanges, 4);
  assert.equal(await avatar.count(), 0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await avatar.waitFor();
  assert.equal(provider.googleCalls, 1);
  assert.equal(exchanges, 5);
  signedIn = false;
  await page.reload();
  await avatar.waitFor();
  assert.equal(
    exchanges,
    6,
    "Google sign-in must also survive cookie expiry and reload",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Session persistence passed: real beta Update, same project, SDK token refresh, cross-tab sign-out, unaccepted session isolation and Google reload.",
  );
  await context.close();
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
