import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const origin = new URL(editorUrl).origin;
const fixture = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const publishableKey = `pk_test_${Buffer.from("popup.clerk.accounts.dev$").toString("base64")}`;
const screenshots = await mkdtemp(join(tmpdir(), "restyle-auth-popup-"));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

// Exercise provider mounting and dismissal without entering credentials or creating an account.
const clerkModule = `
  export class Clerk {
    constructor() { this.session = null; this.user = null; this.listeners = new Set(); }
    async load() {}
    addListener(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    mount(host, mode) {
      const form = document.createElement("div");
      form.dataset.testClerkForm = mode;
      form.textContent = mode === "signup" ? "Managed create-account form" : "Managed sign-in form";
      const complete = document.createElement("button");
      complete.textContent = "Complete mocked email sign-in";
      complete.onclick = () => {
        this.user = { id: "popup-clerk-user", primaryEmailAddress: {
          emailAddress: "popup@example.test", verification: { status: "verified" } } };
        this.session = { id: "popup-clerk-session", getToken: async () => "popup-email-token" };
        for (const listener of this.listeners) listener({ session: this.session, user: this.user });
      };
      form.append(complete);
      host.replaceChildren(form);
    }
    mountSignIn(host) { this.mount(host, "signin"); }
    mountSignUp(host) { this.mount(host, "signup"); }
    unmountSignIn(host) { host.replaceChildren(); }
    unmountSignUp(host) { host.replaceChildren(); }
    async signOut() { this.session = null; this.user = null; }
  }
`;

async function savedProject(page, projectId) {
  return page.evaluate(async id => {
    const result = request => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await result(indexedDB.open("restyle-editor-project", 2));
    try {
      const record = await result(database.transaction("checkpoints").objectStore("checkpoints").get(`project:${id}`));
      if (!record?.assetIds?.length) return null;
      const media = await Promise.all(record.assetIds.map(async assetId => {
        const blob = await result(database.transaction("media").objectStore("media").get(assetId));
        if (!(blob instanceof Blob)) throw new Error(`Saved media ${assetId} is missing`);
        const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
        return [assetId, blob.size, blob.type, Array.from(new Uint8Array(digest))];
      }));
      const { localId, projectName, project, past, future, assetIds } = record;
      return { localId, projectName, project, past, future, assetIds, media };
    } finally { database.close(); }
  }, projectId);
}

async function waitForSavedProject(page, projectId) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const record = await savedProject(page, projectId);
    if (record) return record;
    await page.waitForTimeout(100);
  }
  assert.fail("The imported project was not saved before checking account dismissal");
}

async function checkPopup(phone) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: phone,
    serviceWorkers: "block",
  });
  let signedIn = false;
  let googleCalls = 0;
  let emailCalls = 0;
  let renderCalls = 0;
  const errors = [];
  await context.route(/\/(?:assets\/clerk-[^/]+\.js|node_modules\/\.vite\/deps\/@clerk_clerk-js\.js)(?:\?.*)?$/,
    route => route.fulfill({ status: 200, contentType: "text/javascript", body: clerkModule }));
  await context.route("**/npm/@clerk/ui@1/dist/ui.browser.js", route => route.fulfill({
    status: 200, contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": origin },
    body: "window.__internal_ClerkUICtor = class ClerkUI {};",
  }));
  await context.route(`${origin}/api/auth/**`, route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/session" && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        available: true, clerkAvailable: true, clerkPublishableKey: publishableKey,
        canLinkEmail: false, emailLinked: false,
        user: signedIn ? { id: "popup-editor", name: "Popup tester" } : null,
      }) });
    }
    if (path === "/api/auth/google/start" && request.method() === "GET") {
      googleCalls++;
      signedIn = true;
      return route.fulfill({ status: 200, contentType: "text/html",
        body: `<script>window.opener.postMessage({type:"pvo:auth:complete",ok:true},${JSON.stringify(origin)});window.close()</script>` });
    }
    if (path === "/api/auth/clerk/exchange" && request.method() === "POST") {
      assert.equal(request.headers().authorization, "Bearer popup-email-token");
      emailCalls++;
      signedIn = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    if (path === "/api/auth/logout" && request.method() === "POST") {
      signedIn = false;
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"user":null}' });
    }
    throw new Error(`Unexpected account operation ${request.method()} ${path}`);
  });
  await context.route(`${origin}/api/renders**`, route => {
    if (route.request().method() === "POST") renderCalls++;
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ available: false, formats: [], qualities: [] }) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  const dialog = page.locator("dialog[data-auth-step]");
  const gate = page.getByRole("dialog", { name: "Create a free account", exact: true });
  let trigger;
  const open = async () => {
    trigger = phone
      ? page.getByRole("region", { name: "Account", exact: true }).getByRole("button", { name: "Sign in", exact: true })
      : page.getByRole("banner").getByRole("button", { name: "Sign in", exact: true });
    await trigger.click();
    await gate.waitFor();
  };
  const assertDismissed = async () => {
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate(button => document.activeElement === button), true,
      "Dismissing sign-in must restore focus to its entry button");
  };
  try {
    await page.goto(editorUrl, { waitUntil: "networkidle" });
    const visit = page.getByRole("button", { name: "Visit Site", exact: true });
    if (await visit.isVisible()) await visit.click();
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
    await page.locator("[data-desktop-editor]").waitFor();
    await page.waitForURL(url => url.searchParams.has("project"));
    const projectUrl = page.url();
    const projectId = new URL(projectUrl).searchParams.get("project");
    assert.ok(projectId, "The test must retain a real imported project");
    const before = await waitForSavedProject(page, projectId);
    if (phone) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
    }

    await open();
    const frame = await gate.evaluate(element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { width: Math.round(box.width), x: box.x, right: box.right,
        background: style.backgroundColor, border: style.borderTopColor,
        borderWidth: style.borderTopWidth, radius: style.borderTopLeftRadius };
    });
    assert.equal(frame.width, phone ? 342 : 520, "The popup must match the handed-off responsive width");
    assert.equal(frame.background, "rgb(28, 27, 34)");
    assert.equal(frame.border, "rgb(74, 72, 82)");
    assert.equal(frame.borderWidth, "3px");
    assert.equal(frame.radius, "22px");
    assert(frame.x >= 0 && frame.right <= (phone ? 390 : 1280), "The popup must stay inside the viewport");
    assert.equal(await gate.getByRole("button", { name: "Continue with Google", exact: true }).isEnabled(), true);
    assert.equal(await gate.getByRole("button", { name: "Continue with email", exact: true }).isEnabled(), true);
    assert.equal(await gate.locator("[data-export-account-gate], [data-export-preview]").count(), 0);
    assert.doesNotMatch(await gate.innerText(), /\.mp4|1080p|720p|export settings/i,
      "Standalone sign-in must not present an export summary");
    await page.screenshot({ path: join(screenshots, `${phone ? "phone" : "desktop"}-gate.png`) });

    await gate.getByRole("button", { name: "Continue with email", exact: true }).click();
    await page.getByRole("dialog", { name: "Create account", exact: true }).waitFor();
    await dialog.locator('[data-test-clerk-form="signup"]').waitFor();
    await dialog.getByRole("button", { name: /^Back/ }).click();
    await gate.waitFor();
    await gate.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("dialog", { name: "Welcome back", exact: true }).waitFor();
    await dialog.locator('[data-test-clerk-form="signin"]').waitFor();
    await dialog.getByRole("button", { name: /^Back/ }).click();
    await gate.waitFor();
    await gate.getByRole("button", { name: "Keep editing", exact: true }).click();
    await assertDismissed();

    await open();
    await page.keyboard.press("Escape");
    await assertDismissed();
    await open();
    await dialog.getByRole("button", { name: /^Close/ }).click();
    await assertDismissed();
    await open();
    await page.mouse.click(5, 5);
    await assertDismissed();
    assert.equal(page.url(), projectUrl);
    assert.deepEqual(await savedProject(page, projectId), before,
      "Canceling account sign-in must preserve the project, undo history and exact media bytes");

    await open();
    await gate.getByRole("button", { name: "Sign in", exact: true }).click();
    await dialog.getByRole("button", { name: "Complete mocked email sign-in", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(emailCalls, 1, "Email sign-in must finish its session exchange and close the popup");
    assert.deepEqual(await savedProject(page, projectId), before);
    const accountEntry = phone
      ? page.getByRole("region", { name: "Account", exact: true }).getByRole("button", { name: "Your account", exact: true })
      : page.getByRole("banner").getByRole("button", { name: "Account", exact: true });
    await accountEntry.click();
    await page.getByRole("dialog", { name: "Your account", exact: true }).getByRole("button", { name: "Sign out", exact: true }).click();
    await gate.waitFor();
    const popup = page.waitForEvent("popup");
    await gate.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await popup;
    await dialog.waitFor({ state: "hidden" });
    assert.equal(googleCalls, 1);
    assert.equal(renderCalls, 0, "Standalone Google sign-in must not start an export");
    assert.equal(await page.locator("dialog[data-state]").count(), 0,
      "Standalone Google sign-in must return directly to editing");
    assert.equal(page.url(), projectUrl);
    assert.deepEqual(await savedProject(page, projectId), before);
    assert.deepEqual(errors, []);
    console.log(`${phone ? "Phone" : "Desktop"} standalone account popup passed: design, provider modes, dismissal, retained project, and email/Google completion.`);
  } catch (error) {
    await page.screenshot({ path: join(screenshots, `${phone ? "phone" : "desktop"}-failure.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

try {
  await checkPopup(false);
  await checkPopup(true);
  console.log(`Account popup screenshots: ${screenshots}`);
} finally { await browser.close(); }
