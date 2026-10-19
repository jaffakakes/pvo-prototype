import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
});
const base = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
try {
  for (const [width, height, theme] of [
    [393, 852, "light"],
    [393, 852, "dark"],
    [320, 568, "light"],
    [1280, 900, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let user = { id: "menu-test", name: "Maya Rivera" },
      profile = { ...user, email: "maya@studio.com", photo: null },
      fail = false;
    await context.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          user,
          available: true,
          clerkAvailable: false,
          clerkPublishableKey: null,
          canLinkEmail: false,
          emailLinked: false,
        },
      }),
    );
    await context.route("**/api/account/profile", async (route) => {
      if (route.request().method() === "PUT") {
        if (fail)
          return route.fulfill({ status: 500, json: { error: "fixture" } });
        profile = route.request().postDataJSON();
      }
      await route.fulfill({ json: profile });
    });
    await context.route("**/api/auth/logout", (route) => {
      user = null;
      return route.fulfill({ json: { user: null } });
    });
    await page.goto(base);
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
    await page.waitForTimeout(700);
    const avatar = page.getByRole("button", {
      name: "Account · Maya Rivera",
      exact: true,
    });
    await avatar.click();
    const menu = page.getByRole("menu", { name: "Account", exact: true });
    await menu.waitFor();
    assert.equal(
      await page
        .getByRole("menuitem", { name: "Edit profile", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page
        .getByRole("menuitem", { name: "Sign out", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.keyboard.press("Home");
    await page.keyboard.press("Escape");
    assert.equal(
      await avatar.evaluate((e) => e === document.activeElement),
      true,
    );
    await avatar.click();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: join(tmpdir(), `account-menu-${width}-${theme}.png`),
    });
    const box = await menu.boundingBox();
    assert(box.x >= 9 && box.x + box.width <= width - 8);
    assert.equal(
      await page
        .getByRole("menuitem", { name: "Join our Discord" })
        .getAttribute("aria-disabled"),
      "true",
    );
    await page.getByRole("menuitem", { name: "Change theme" }).click();
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await page.getByRole("button", { name: "Back to account menu" }).click();
    await page.getByRole("menuitem", { name: "Edit profile" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Maya Updated");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const updated = page.getByRole("button", {
      name: "Account · Maya Updated",
      exact: true,
    });
    await updated.click();
    fail = true;
    await page
      .getByLabel("Profile photo", { exact: true })
      .setInputFiles(
        new URL("../../../editor/public/restyle-mark.png", import.meta.url)
          .pathname,
      );
    await page
      .getByText("Couldn't upload photo. Try again.", { exact: true })
      .waitFor();
    assert.equal(await updated.locator("img").count(), 0);
    fail = false;
    await page
      .getByLabel("Profile photo", { exact: true })
      .setInputFiles(
        new URL("../../../editor/public/restyle-mark.png", import.meta.url)
          .pathname,
      );
    await updated.locator("img").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Add a photo", exact: true })
        .count(),
      0,
    );
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: join(tmpdir(), `account-photo-${width}-${theme}.png`),
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Account · Maya Updated", exact: true })
      .locator("img")
      .waitFor();
    await page
      .getByRole("button", { name: "Account · Maya Updated", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
    assert(
      await page.getByText(/^Saved in this browser(?: ·.*)?$/).isVisible(),
    );
    assert.deepEqual(errors, []);
    console.log(
      `${width} ${theme}: avatar, keyboard, theme, name, photo failure/retry, reload and sign out passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
