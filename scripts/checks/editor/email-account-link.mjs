import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const origin = new URL(editorUrl).origin;
const publishableKey = `pk_test_${Buffer.from("test.clerk.accounts.dev$").toString("base64")}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

// A small provider stand-in exercises the app's review and exchange boundaries without a real password.
const clerkModule = `
  const account = email => ({ id: "user_" + email, primaryEmailAddress: {
    emailAddress: email, verification: { status: "verified" } } });
  const session = token => ({ id: "sess_" + token, getToken: async () => token });
  export class Clerk {
    constructor() {
      window.__clerk = this;
      this.listeners = [];
      this.user = account("old@example.test");
      this.session = session("old-token");
    }
    async load() {}
    addListener(listener) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter(item => item !== listener); };
    }
    mountSignIn(host) {
      const button = document.createElement("button");
      button.textContent = "Sign in as fresh@example.test";
      button.onclick = () => {
        this.user = account("fresh@example.test");
        this.session = session("fresh-token");
        for (const listener of this.listeners) listener({ user: this.user, session: this.session });
      };
      host.replaceChildren(button);
    }
    mountSignUp(host) { this.mountSignIn(host); }
    unmountSignIn(host) { host.replaceChildren(); }
    unmountSignUp(host) { host.replaceChildren(); }
    async signOut(callback) {
      this.user = null;
      this.session = null;
      for (const listener of this.listeners) listener({ user: null, session: null });
      callback?.();
    }
  }
`;

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  let signedIn = true;
  let emailLinked = false;
  let googlePopup = "cancel";
  let linkStatus = 409;
  let linkCalls = 0;
  let exchangeCalls = 0;
  const user = { id: "editor-account-1", name: "Editor tester" };
  await context.route(/\/(?:assets\/clerk-[^/]+\.js|node_modules\/\.vite\/deps\/@clerk_clerk-js\.js)(?:\?.*)?$/, route => route.fulfill({ status: 200,
    contentType: "text/javascript", body: clerkModule }));
  await context.route("**/npm/@clerk/ui@1/dist/ui.browser.js", route => route.fulfill({ status: 200,
    contentType: "text/javascript", body: "window.__internal_ClerkUICtor = class ClerkUI {};" }));
  await context.route(`${origin}/api/auth/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/session" && request.method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        available: true, user: signedIn ? user : null, clerkAvailable: true,
        clerkPublishableKey: publishableKey, canLinkEmail: signedIn && !emailLinked,
        emailLinked: signedIn && emailLinked,
      }) });
    if (path === "/api/auth/google/start" && request.method() === "GET")
      return route.fulfill({ status: 200, contentType: "text/html", body: googlePopup === "cancel"
        ? "<script>window.close()</script>"
        : `<script>window.opener.postMessage({type:"pvo:auth:complete",ok:true},${JSON.stringify(origin)});window.close()</script>` });
    if (path === "/api/auth/clerk/link" && request.method() === "POST") {
      linkCalls++;
      assert.equal(request.headers().authorization, `Bearer ${linkCalls === 1 ? "old-token" : "fresh-token"}`);
      assert.deepEqual(JSON.parse(request.postData()), { expectedUserId: user.id });
      if (linkStatus === 200) emailLinked = true;
      return route.fulfill({ status: linkStatus, contentType: "application/json",
        body: JSON.stringify(linkStatus === 200 ? { user } : { error: "already linked" }) });
    }
    if (path === "/api/auth/clerk/exchange" && request.method() === "POST") {
      exchangeCalls++;
      assert.equal(request.headers().authorization, "Bearer old-token");
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
  assert.equal(await account.locator("[data-clerk-account-review]").count(), 0,
    "Closing Google reauthentication cannot open the email link form");
  assert.equal(linkCalls, 0);

  googlePopup = "success";
  await startLink();
  const review = account.locator("[data-clerk-account-review]");
  await review.getByText("old@example.test").waitFor();
  assert.equal(linkCalls, 0, "A lingering Clerk browser session must wait for explicit confirmation");
  await review.getByRole("button", { name: "Connect this email" }).click();
  await account.getByRole("alert").getByText(/already connected to another Restyle account/).waitFor();
  assert.equal(linkCalls, 1);
  await account.getByRole("button", { name: "Use another email" }).click();
  await account.getByRole("button", { name: "Sign in as fresh@example.test" }).click();
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
  await page.evaluate(() => {
    const clerk = window.__clerk;
    clerk.user = { id: "user_old@example.test", primaryEmailAddress: {
      emailAddress: "old@example.test", verification: { status: "verified" } } };
    clerk.session = { id: "sess_old-token", getToken: async () => "old-token" };
  });
  await signIn.getByRole("button", { name: "Continue with email" }).click();
  await signIn.getByRole("button", { name: "Continue as old@example.test" }).waitFor();
  assert.equal(exchangeCalls, 0, "An old Clerk browser session must not silently open an account");
  await signIn.getByRole("button", { name: "Continue as old@example.test" }).click();
  await signIn.waitFor({ state: "hidden" });
  assert.equal(exchangeCalls, 1);
  assert.deepEqual(errors, []);
  console.log("Email account browser gate passed: canceled Google popup, explicit existing-session review, conflict and switch, linked account, and ordinary email confirmation.");
  await context.close();
} finally {
  await browser.close();
}
