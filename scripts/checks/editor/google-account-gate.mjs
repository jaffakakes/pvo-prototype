import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const origin = new URL(editorUrl).origin;
const fixture = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const publishableKey = `pk_test_${Buffer.from("export.clerk.accounts.dev$").toString("base64")}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

const clerkModule = `
  export class Clerk {
    constructor() { this.session = null; this.user = null; this.listeners = new Set(); }
    async load() {}
    addListener(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    mountSignIn(host) {
      const button = document.createElement("button");
      button.textContent = "Complete mocked email sign-in";
      button.onclick = () => {
        this.user = { id: "user_export", primaryEmailAddress: {
          emailAddress: "export@example.test", verification: { status: "verified" } } };
        this.session = { id: "sess_export", getToken: async () => "export-email-token" };
        for (const listener of this.listeners) listener({ session: this.session, user: this.user });
      };
      host.replaceChildren(button);
    }
    unmountSignIn(host) { host.replaceChildren(); }
  }
`;

async function checkAccountGate(phone) {
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: phone,
    hasTouch: phone,
    serviceWorkers: "block",
  });
  let signedIn = false;
  let checks = 0;
  let emailExchanges = 0;
  const renders = [];
  await context.route(/\/(?:assets\/clerk-[^/]+\.js|node_modules\/\.vite\/deps\/@clerk_clerk-js\.js)(?:\?.*)?$/,
    route => route.fulfill({ status: 200, contentType: "text/javascript", body: clerkModule }));
  await context.route("**/npm/@clerk/ui@1/dist/ui.browser.js", route => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    headers: { "Access-Control-Allow-Origin": origin },
    body: "window.__internal_ClerkUICtor = class ClerkUI {};",
  }));
  await context.route(`${origin}/api/auth/**`, route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/session" && request.method() === "GET") {
      checks++;
      return json({
        available: true,
        clerkAvailable: true,
        clerkPublishableKey: publishableKey,
        canLinkEmail: false,
        emailLinked: false,
        user: signedIn ? { id: "editor-1", name: "Editor tester" } : null,
      });
    }
    if (path === "/api/auth/google/start" && request.method() === "GET") {
      signedIn = true;
      return route.fulfill({ status: 200, contentType: "text/html",
        body: `<script>window.opener.postMessage({type:"pvo:auth:complete",ok:true},${JSON.stringify(origin)});window.close()</script>` });
    }
    if (path === "/api/auth/clerk/exchange" && request.method() === "POST") {
      assert.equal(request.headers().authorization, "Bearer export-email-token");
      emailExchanges++;
      signedIn = true;
      return json({ user: { id: "editor-1", name: "Editor tester" } });
    }
    throw new Error(`Unexpected account operation ${request.method()} ${path}`);
  });
  await context.route(`${origin}/api/renders**`, route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/renders" && request.method() === "GET")
      return json({ available: true, maxSourceBytes: 512 * 1024 * 1024, maxSources: 16,
        formats: ["video"], qualities: ["720p", "1080p", "4K"] });
    if (path === "/api/renders" && request.method() === "POST") {
      assert.equal(signedIn, true, "Rendering must only start after a verified account session");
      renders.push(request.postDataJSON());
      return json({ id: `gate_${renders.length}`, status: "uploading", progress: 0 }, 201);
    }
    if (request.method() === "PUT") return json({ uploaded: true });
    if (request.method() === "DELETE") return json({ cancelled: true });
    const match = /^\/api\/renders\/(gate_\d+)(?:\/start)?$/.exec(path);
    if (match) return json({ id: match[1], status: "rendering", progress: .4 });
    throw new Error(`Unexpected render operation ${request.method()} ${path}`);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const exportSheet = page.locator("dialog[data-state]");
  const gate = exportSheet.locator("[data-export-account-gate]");
  const beginExport = async () => {
    if (phone) {
      await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("button", { name: "Flat video", exact: true }).click();
    } else await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();
    await exportSheet.waitFor();
  };
  const start = () => exportSheet.getByRole("button", { name: /Export video/ }).click();
  const chooseQuality = () => exportSheet.getByRole("radiogroup", { name: "Export quality" })
    .getByRole("radio", { name: /^720p/ }).click();
  const verifyGate = async () => {
    await gate.waitFor();
    assert.equal(await page.locator("dialog:modal").count(), 1,
      "Sign-in must remain inside the existing export dialog");
    assert.match(await gate.getByRole("group", { name: "Selected export settings" }).innerText(), /720p/);
    assert.equal(await gate.getByRole("link", { name: "Privacy Policy" }).count(), 1);
  };
  const waitForRender = async count => {
    const deadline = Date.now() + 15000;
    while (renders.length < count && Date.now() < deadline) await page.waitForTimeout(50);
    assert.equal(renders.length, count, "Sign-in must resume exactly one queued export");
    assert.equal(renders.at(-1).source.quality, "720p", "Sign-in must retain export settings");
    await page.locator('dialog[data-state="exporting"]').waitFor();
    await exportSheet.getByRole("button", { name: "Cancel export" }).click();
    await page.locator('dialog[data-state="setup"]').waitFor();
  };
  try {
    await page.goto(editorUrl, { waitUntil: "networkidle" });
    const visit = page.getByRole("button", { name: "Visit Site", exact: true });
    if (await visit.isVisible()) await visit.click();
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
    await page.locator("[data-desktop-editor], .editorWorkspace").first().waitFor();

    await beginExport();
    await chooseQuality();
    assert.equal(await gate.count(), 0, "A guest can choose export settings before sign-in");
    assert.equal(renders.length, 0);
    await start();
    await verifyGate();
    assert.equal(renders.length, 0, "Showing sign-in must not create a render job");
    await exportSheet.getByRole("button", { name: "Keep editing" }).click();
    await exportSheet.waitFor({ state: "hidden" });

    await beginExport();
    await start();
    await verifyGate();
    const popup = page.waitForEvent("popup");
    await gate.getByRole("button", { name: "Continue with Google" }).click();
    await popup;
    await waitForRender(1);

    signedIn = false;
    const checksBeforeStart = checks;
    await start();
    await verifyGate();
    assert(checks > checksBeforeStart, "Every export checks the live account, including after expiry");
    await gate.getByRole("button", { name: "Continue with email" }).click();
    await gate.getByRole("button", { name: "Complete mocked email sign-in" }).click();
    await waitForRender(2);
    assert.equal(emailExchanges, 1);
    assert.deepEqual(errors, []);
    console.log(`${phone ? "Phone" : "Desktop"} export account gate passed: settings first, dismissal, Google/email resume, session expiry, and retained quality.`);
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
