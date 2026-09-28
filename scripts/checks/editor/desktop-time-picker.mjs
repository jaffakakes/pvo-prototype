import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const inspector = page.locator("[data-desktop-inspector]");
const timeline = page.locator("[data-desktop-timeline]");
const picker = timeline.getByRole("group", { name: "Choose playhead time" });
const state = () =>
  page.evaluate(() => {
    const value = window.pickerCapture.getState();
    return {
      time: value.t,
      component: value.components[0],
      past: value.past.length,
      picking: value.playheadPick !== null,
    };
  });

async function scrub(time, lane = false) {
  const ruler = await timeline.getByLabel("Seek timeline").boundingBox();
  const y = lane ? ruler.y + 100 : ruler.y + 10;
  await page.mouse.click(ruler.x + time * 40, y);
  assert(
    Math.abs((await state()).time - time) < 0.05,
    "Picker can scrub the requested timeline time",
  );
}

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", {
    waitUntil: "networkidle",
  });
  await page.evaluate(async () => {
    window.pickerCapture = (await import("/src/store.ts")).useCapture;
    const clip = {
      id: 1,
      url: null,
      color: "#594066",
      srcDur: 12,
      in: 0,
      out: 12,
      speed: 1,
      zoom: 1,
      mirror: false,
      width: 720,
      height: 1280,
      fit: "cover",
    };
    const scene = {
      id: "main",
      name: "Main",
      parent: null,
      clips: [clip],
      texts: [],
      components: [],
      muted: false,
      sound: 0,
      layers: ["video"],
    };
    const capture = window.pickerCapture.getState();
    capture.patch({
      scenes: [scene],
      currentSceneId: "main",
      clips: [clip],
      texts: [],
      components: [],
      screen: "editor",
      sel: -1,
      t: 3,
      sheet: null,
      past: [],
      future: [],
    });
    const id = capture.addComponent("card");
    capture.updateComponent(id, { at: 3, dur: 3 });
    capture.patch({ past: [], future: [] });
  });
  await inspector.getByRole("tab", { name: "Content", exact: true }).click();
  await inspector
    .getByRole("button", { name: "Pick on timeline", exact: true })
    .click();
  await picker.waitFor();
  assert.equal(
    await picker
      .getByRole("button", { name: "Cancel", exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(
    await inspector.evaluate((element) => !!element.closest("[inert]")),
    true,
  );
  await scrub(5);
  assert.equal(
    (await state()).component.at,
    3,
    "Scrubbing previews without committing timing",
  );
  await picker.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(
    {
      time: (await state()).time,
      at: (await state()).component.at,
      past: (await state()).past,
    },
    { time: 3, at: 3, past: 0 },
  );
  assert.equal(
    await inspector.evaluate((element) => !!element.closest("[inert]")),
    false,
  );

  await inspector
    .getByRole("button", { name: "Pick on timeline", exact: true })
    .click();
  await scrub(6, true);
  await picker.getByRole("button", { name: "Use 0:06", exact: true }).click();
  assert.equal((await state()).component.at, 6);
  assert.equal(
    (await state()).past,
    1,
    "Accepting timing creates exactly one undo step",
  );
  assert.equal((await state()).picking, false);

  await inspector.getByRole("tab", { name: "Action", exact: true }).click();
  await inspector.getByRole("button", { name: /When viewers tap/ }).click();
  await inspector
    .getByRole("button", { name: "Pick on timeline", exact: true })
    .click();
  await picker.getByText("Jump to when?", { exact: true }).waitFor();
  await scrub(2);
  await page.keyboard.press("Enter");
  assert.deepEqual((await state()).component.fields.buttons[0].outcome, {
    kind: "time",
    t: 2,
  });
  assert.equal((await state()).past, 2);
  assert.equal((await state()).picking, false);

  await page.setViewportSize({ width: 1024, height: 768 });
  await inspector
    .getByRole("button", { name: "Pick on timeline", exact: true })
    .click();
  await picker.waitFor();
  const bounds = await picker.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 1024);
  await scrub(4);
  await page.mouse.move(980, 200);
  await page.keyboard.press("Escape");
  assert.equal(
    (await state()).time,
    2,
    "Escape works while the pointer is over the inert Inspector",
  );
  assert.equal((await state()).picking, false);
  assert.equal((await state()).past, 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop component/action timeline picking, scrub-any-lane, atomic accept, lossless cancel, keyboard and tablet controls.",
  );
} finally {
  await browser.close();
}
