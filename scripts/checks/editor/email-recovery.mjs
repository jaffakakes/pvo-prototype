import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";

import { installSupabaseFixture, fillEmailForm, supabaseUrl, publishableKey } from "./supabase-fixture.mjs";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const origin = new URL(editorUrl).origin;
const browser = await launchBrowser({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const provider = await installSupabaseFixture(context);
  let signedIn = false;
  let exchanges = 0;
  await context.route(`${origin}/api/auth/**`, route => {
    const path = new URL(route.request().url()).pathname;
    const json = value => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/auth/session") return json({ available: true, supabaseAvailable: true, supabaseUrl,
      supabasePublishableKey: publishableKey,
      user: signedIn ? { id: "fixture", name: "Creator" } : null });
    if (path === "/api/auth/supabase/exchange") { exchanges++; signedIn = true; return json({ user: { id: "fixture", name: "Creator" } }); }
    if (path === "/api/auth/logout") { signedIn = false; return json({ user: null }); }
    throw new Error(`Unexpected account route ${path}`);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const dialog = page.locator("dialog[data-auth-step]");
  const open = async () => {
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await dialog.waitFor();
  };
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await open();
  await dialog.getByRole("button", { name: "Continue with email", exact: true }).click();
  provider.confirmationRequired = true;
  await fillEmailForm(dialog, "new@example.test");
  await dialog.getByRole("status").getByText(/confirmation link/).waitFor();
  assert.equal(exchanges, 0, "A signup waiting for verification cannot create a Restyle session");
  assert.equal(provider.signups, 1);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  provider.failPassword = true;
  await fillEmailForm(dialog, "new@example.test");
  await dialog.getByRole("alert").getByText(/Check your email and password/).waitFor();
  assert.equal(await dialog.getByLabel("Email address").inputValue(), "new@example.test");
  await dialog.getByRole("button", { name: "Forgot password?" }).click();
  await dialog.locator('button[type="submit"]').click();
  await dialog.getByRole("status").getByText(/reset link is on its way/).waitFor();
  assert.equal(provider.recoveryCalls, 1);
  assert.equal(exchanges, 0);
  provider.failPassword = false;
  await page.goto(`${origin}/editor/?auth=recovery&code=fixture-recovery`, { waitUntil: "networkidle" });
  await page.getByRole("dialog", { name: "Reset password" }).waitFor();
  assert.equal(exchanges, 0, "A recovery callback must not sign in before the password is changed");
  assert.equal(new URL(page.url()).searchParams.has("code"), false, "Auth codes must leave the URL");
  await dialog.getByLabel("New password").fill("fixture-new-password");
  await dialog.getByRole("button", { name: "Save new password" }).click();
  await dialog.getByRole("status").getByText(/Password updated/).waitFor();
  assert.equal(provider.passwordUpdates, 1);
  await dialog.getByRole("button", { name: /^Continue as/ }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(exchanges, 1);
  await page.getByRole("button", { name: "Account", exact: true }).first().click();
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue with email", exact: true }).waitFor();
  assert.equal(provider.session, null, "Sign-out clears the Supabase session as well as Restyle");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  let finishRequest;
  provider.blockPassword = new Promise(resolve => { finishRequest = resolve; });
  await fillEmailForm(dialog, "cancelled@example.test");
  await dialog.getByRole("button", { name: "Close sign in" }).click();
  finishRequest();
  await page.waitForTimeout(250);
  assert.equal(exchanges, 1, "Dismissing an in-flight sign-in cannot exchange its late session");
  assert.deepEqual(errors, []);
  console.log("Email recovery passed: verification pending, invalid credentials, reset request, PKCE return, password update, sign-out and cancelled sign-in.");
  await context.close();
} finally { await browser.close(); }
