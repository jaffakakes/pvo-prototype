import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const origin = new URL(editorUrl).origin;
const fixture = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

async function checkAccountGate(phone) {
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: phone,
    hasTouch: phone,
  });
  let signedIn = false;
  let checks = 0;
  await context.route(`${origin}/api/auth/**`, route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/session" && request.method() === "GET") {
      checks++;
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ available: true, clerkAvailable: true, clerkPublishableKey: "pk_test_invalid",
          canLinkEmail: signedIn, emailLinked: false,
          user: signedIn ? { id: "editor-1", name: "Editor tester" } : null }) });
    }
    if (path === "/api/auth/google/start" && request.method() === "GET") {
      signedIn = true;
      return route.fulfill({ status: 200, contentType: "text/html",
        body: `<script>window.opener.postMessage({type:"pvo:auth:complete",ok:true},${JSON.stringify(origin)});window.close()</script>` });
    }
    throw new Error(`Unexpected account operation ${request.method()} ${path}`);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const auth = page.locator("dialog[data-auth-step]");
  const exportSheet = page.getByRole("dialog", { name: "Export", exact: true });
  const beginExport = async () => {
    if (phone) {
      await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("button", { name: "Flat video", exact: true }).click();
    } else await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();
  };
  const completeGoogle = async () => {
    const popup = page.waitForEvent("popup");
    await auth.getByRole("button", { name: "Continue with Google" }).click();
    await popup;
    await auth.waitFor({ state: "hidden" });
  };
  try {
    await page.goto(editorUrl, { waitUntil: "networkidle" });
    const visit = page.getByRole("button", { name: "Visit Site", exact: true });
    if (await visit.isVisible()) await visit.click();
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
    await page.locator("[data-desktop-editor], .editorWorkspace").first().waitFor();

    await beginExport();
    await auth.waitFor();
    assert.equal(await exportSheet.count(), 0, "A guest must not reach export settings from the toolbar");
    await auth.getByRole("button", { name: "Continue with email" }).click();
    await auth.locator("[data-clerk-email-sign-in]").waitFor();
    await auth.getByRole("button", { name: "Back to sign-in options" }).click();
    assert.equal(await auth.locator("[data-clerk-email-sign-in]").count(), 0,
      "Returning from email sign-in keeps the original account gate open");
    await auth.getByRole("button", { name: "Keep editing" }).click();
    assert.equal(await exportSheet.count(), 0, "Dismissing sign-in cancels the queued export");

    await beginExport();
    await auth.waitFor();
    await completeGoogle();
    await exportSheet.waitFor();
    await exportSheet.getByRole("button", { name: "720p Faster · smaller file" }).click();

    signedIn = false;
    const checksBeforeStart = checks;
    await exportSheet.getByRole("button", { name: "Export video", exact: true }).click();
    await auth.waitFor();
    assert(checks > checksBeforeStart, "Starting a render checks the live account session");
    assert.equal(await exportSheet.getByRole("button", { name: "720p Faster · smaller file" }).getAttribute("data-on"), "true",
      "Sign-in preserves export settings after session expiry");
    await completeGoogle();
    await exportSheet.getByText("Rendering…").waitFor();
    assert.deepEqual(errors, []);
    console.log(`${phone ? "Phone" : "Desktop"} Google account gate passed: dismissal, popup resume and session expiry.`);
  } finally {
    await context.close();
  }
}

try {
  await checkAccountGate(false);
  await checkAccountGate(true);
} finally {
  await browser.close();
}
