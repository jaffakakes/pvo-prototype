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

const people = {
  first: { id: "theme-person/one", name: "Theme One" },
  second: { id: "theme-person:two", name: "Theme Two" },
};

async function expectRootTheme(page, { mode, accent, color }) {
  await page.waitForFunction(({ expectedMode, expectedAccent }) =>
    document.documentElement.dataset.theme === expectedMode
      && document.documentElement.dataset.accent === expectedAccent,
  { expectedMode: mode, expectedAccent: accent });
  const actual = await page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    return {
      mode: root.dataset.theme,
      accent: root.dataset.accent,
      colorScheme: style.colorScheme,
      color: style.getPropertyValue("--accent").trim().toLowerCase(),
      ground: style.getPropertyValue("--ground").trim().toLowerCase(),
    };
  });
  assert.equal(actual.colorScheme, mode);
  if (color) assert.equal(actual.color, color);
  return actual;
}

async function openMore(page) {
  await page.getByRole("button", { name: "More settings", exact: true }).click();
  const more = page.getByRole("dialog", { name: "More", exact: true });
  await more.waitFor();
  return more;
}

async function changeAccount(page) {
  const response = page.waitForResponse(reply => new URL(reply.url()).pathname === "/api/auth/session"
    && reply.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await response;
}

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: "dark",
});
let activeUser = null;
let logoutCalls = 0;
const errors = [];
await context.route(`${origin}/api/auth/**`, route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path === "/api/auth/session" && request.method() === "GET") {
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({
        available: true,
        clerkAvailable: false,
        clerkPublishableKey: null,
        canLinkEmail: false,
        emailLinked: false,
        user: activeUser,
      }) });
  }
  if (path === "/api/auth/logout" && request.method() === "POST") {
    logoutCalls++;
    activeUser = null;
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"user":null}' });
  }
  throw new Error(`Unexpected account operation ${request.method()} ${path}`);
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", error => errors.push(error.message));

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
  await page.locator("[data-desktop-editor]").waitFor();

  const guestDark = await expectRootTheme(page, { mode: "dark", accent: "magenta", color: "#ff2d78" });
  let more = await openMore(page);
  const modes = more.getByRole("group", { name: "Color mode" });
  assert.equal(await modes.getByRole("button", { name: "System" }).getAttribute("aria-pressed"), "true");
  assert.equal(await more.getByRole("group", { name: "Accent color" }).count(), 0,
    "A guest must not be offered account accent choices");
  assert.match(await more.innerText(), /Magenta is the guest color/);

  await modes.getByRole("button", { name: "Light" }).click();
  const guestLight = await expectRootTheme(page, { mode: "light", accent: "magenta" });
  assert.notEqual(guestLight.ground, guestDark.ground, "Light mode must change the editor surface");
  assert.equal(await modes.getByRole("button", { name: "Light" }).getAttribute("aria-pressed"), "true");
  await modes.getByRole("button", { name: "Dark" }).click();
  await expectRootTheme(page, { mode: "dark", accent: "magenta", color: "#ff2d78" });
  await modes.getByRole("button", { name: "System" }).click();
  await expectRootTheme(page, { mode: "dark", accent: "magenta" });
  await page.emulateMedia({ colorScheme: "light" });
  await expectRootTheme(page, { mode: "light", accent: "magenta" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expectRootTheme(page, { mode: "dark", accent: "magenta" });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-desktop-editor]").waitFor();
  await expectRootTheme(page, { mode: "dark", accent: "magenta" });
  more = await openMore(page);
  assert.equal(await more.getByRole("group", { name: "Color mode" })
    .getByRole("button", { name: "System" }).getAttribute("aria-pressed"), "true",
  "The explicit System choice must survive reload");

  activeUser = people.first;
  await changeAccount(page);
  const accents = more.getByRole("group", { name: "Accent color" });
  await accents.waitFor();
  assert.deepEqual(await accents.getByRole("button").allTextContents(),
    ["Magenta", "Orange", "Emerald", "Cyan", "Blue", "Violet"]);
  await accents.getByRole("button", { name: "Cyan" }).click();
  await expectRootTheme(page, { mode: "dark", accent: "cyan", color: "#00d4ff" });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-desktop-editor]").waitFor();
  await expectRootTheme(page, { mode: "dark", accent: "cyan", color: "#00d4ff" });
  more = await openMore(page);
  assert.equal(await more.getByRole("button", { name: "Cyan" }).getAttribute("aria-pressed"), "true");

  activeUser = people.second;
  await changeAccount(page);
  await expectRootTheme(page, { mode: "dark", accent: "magenta", color: "#ff2d78" });
  await more.getByRole("group", { name: "Accent color" }).getByRole("button", { name: "Violet" }).click();
  await expectRootTheme(page, { mode: "dark", accent: "violet", color: "#8b2dff" });

  activeUser = people.first;
  await changeAccount(page);
  await expectRootTheme(page, { mode: "dark", accent: "cyan", color: "#00d4ff" });

  await more.getByRole("region", { name: "Account" }).getByRole("button", { name: "Your account" }).click();
  await page.getByRole("dialog", { name: "Your account" }).getByRole("button", { name: "Sign out" }).click();
  await expectRootTheme(page, { mode: "dark", accent: "magenta", color: "#ff2d78" });
  assert.equal(logoutCalls, 1);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-desktop-editor]").waitFor();
  await expectRootTheme(page, { mode: "dark", accent: "magenta", color: "#ff2d78" });

  activeUser = people.second;
  await changeAccount(page);
  await expectRootTheme(page, { mode: "dark", accent: "violet", color: "#8b2dff" });
  assert.deepEqual(errors, []);
  console.log("Editor theme passed: guest magenta, light/dark/system and live OS change, account accent picker, account isolation, sign-out reset and reload.");
} finally {
  await context.close();
  await browser.close();
}
