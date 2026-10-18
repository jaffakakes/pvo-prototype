import { installSupabaseFixture, fillEmailForm, supabaseUrl, publishableKey } from "./supabase-fixture.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const origin = new URL(editorUrl).origin;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

// A small provider stand-in exercises the app's review and exchange boundaries without a real password.


try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  let signedIn = true;
  let emailLinked = false;
  let googlePopup = "cancel";
  let linkStatus = 409;
  let linkCalls = 0;
  let exchangeCalls = 0;
  const user = { id: "editor-account-1", name: "Editor tester" };
  const provider = await installSupabaseFixture(context, "old@example.test");
  const existingSession = provider.session;
  await context.route(`${origin}/api/auth/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/session" && request.method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        available: true, user: signedIn ? user : null, supabaseAvailable: true,
        supabasePublishableKey: publishableKey, supabaseUrl, canLinkEmail: signedIn && !emailLinked,
        emailLinked: signedIn && emailLinked,
      }) });
    if (path === "/api/auth/google/start" && request.method() === "GET")
      return route.fulfill({ status: 200, contentType: "text/html", body: googlePopup === "cancel"
        ? "<script>window.close()</script>"
        : `<script>window.opener.postMessage({type:"pvo:auth:complete",ok:true},${JSON.stringify(origin)});window.close()</script>` });
    if (path === "/api/auth/supabase/link" && request.method() === "POST") {
      linkCalls++;
      assert.equal(request.headers().authorization, `Bearer ${provider.session.access_token}`);
      assert.deepEqual(JSON.parse(request.postData()), { expectedUserId: user.id });
      if (linkStatus === 200) emailLinked = true;
      return route.fulfill({ status: linkStatus, contentType: "application/json",
        body: JSON.stringify(linkStatus === 200 ? { user } : { error: "already linked" }) });
    }
    if (path === "/api/auth/supabase/exchange" && request.method() === "POST") {
      exchangeCalls++;
      assert.equal(request.headers().authorization, `Bearer ${provider.session.access_token}`);
      signedIn = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
    }
    if (path === "/api/auth/logout" && request.method() === "POST") {
      signedIn = false;
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"user":null}' });
    }
    throw new Error(`Unexpected account operation ${request.method()} ${path}`);
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.getByRole("button", { name: "Account", exact: true }).first().click();
  const account = page.getByRole("dialog", { name: "Your account" });
  await account.waitFor();
  const startLink = async () => {
    const popup = page.waitForEvent("popup");
    await account.getByRole("button", { name: "Connect email sign-in" }).click();
    await popup;
  };

  await startLink();
  await account.getByRole("alert").getByText(/closed before confirming/).waitFor();
  assert.equal(await account.locator("[data-supabase-account-review]").count(), 0,
    "Closing Google reauthentication cannot open the email link form");
  assert.equal(linkCalls, 0);

  googlePopup = "success";
  await startLink();
  const review = account.locator("[data-supabase-account-review]");
  await review.getByText("old@example.test").waitFor();
  assert.equal(linkCalls, 0, "A lingering Supabase browser session must wait for explicit confirmation");
  await review.getByRole("button", { name: "Connect this email" }).click();
  await account.getByRole("alert").getByText(/already connected to another Restyle account/).waitFor();
  assert.equal(linkCalls, 1);
  await account.getByRole("button", { name: "Use another email" }).click();
  await fillEmailForm(account, "fresh@example.test");
  await review.getByText("fresh@example.test").waitFor();
  assert.equal(linkCalls, 1, "A newly entered email still requires link confirmation");
  linkStatus = 200;
  await review.getByRole("button", { name: "Connect this email" }).click();
  await account.getByText(/Email sign-in connected/).waitFor();
  assert.equal(linkCalls, 2);
  assert.equal(signedIn, true, "Linking must retain the Google Restyle session");

  await account.getByRole("button", { name: "Sign out" }).click();
  const signIn = page.locator("dialog[data-auth-step]");
  await page.getByRole("dialog", { name: "Create a free account", exact: true }).waitFor();
  await signIn.waitFor();
  provider.session = existingSession;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await signIn.getByRole("button", { name: "Continue with email" }).click();
  await signIn.getByRole("button", { name: "Continue as old@example.test" }).waitFor();
  assert.equal(exchangeCalls, 0, "An old Supabase browser session must not silently open an account");
  await signIn.getByRole("button", { name: "Continue as old@example.test" }).click();
  await signIn.waitFor({ state: "hidden" });
  assert.equal(exchangeCalls, 1);
  assert.deepEqual(errors, []);
  console.log("Email account browser gate passed: canceled Google popup, explicit existing-session review, conflict and switch, linked account, and ordinary email confirmation.");
  await context.close();
} finally {
  await browser.close();
}
