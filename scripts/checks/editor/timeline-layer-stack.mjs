import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl =
  process.env.EDITOR_URL ||
  process.env.RESTYLE_EDITOR_URL ||
  "http://127.0.0.1:5173/";
const chromePath =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15_000);

async function addComponent(buttonName, dialogName) {
  const components = page.getByRole("button", {
    name: "Components",
    exact: true,
  });
  const collapse = page.getByRole("button", {
    name: "Collapse component tools",
  });
  if (!(await components.isVisible())) {
    await collapse.waitFor();
    await collapse.click();
  }
  await components.click();
  await page
    .getByRole("button", { name: new RegExp(`^${buttonName}`) })
    .click();
  const editor = page.getByRole("dialog", { name: dialogName, exact: true });
  await editor.waitFor();
  await editor.getByRole("button", { name: "Done", exact: true }).click();
}

async function assertSeparateMobileRows() {
  const result = await page.locator(".tl").evaluate((timeline) => {
    const boxes = (selector, attribute) =>
      [...timeline.querySelectorAll(selector)].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          id: element.getAttribute(attribute),
          top: box.top,
          bottom: box.bottom,
        };
      });
    return {
      bars: boxes('[data-layer-id^="component:"]', "data-layer-id"),
      labels: boxes(
        '[data-reorder-layer^="component:"]',
        "data-reorder-layer",
      ),
      videoTop: timeline
        .querySelector('[data-layer-id="video"]')
        .getBoundingClientRect().top,
    };
  });

  assert.equal(result.bars.length, 3);
  assert.deepEqual(
    result.labels.map((row) => row.id),
    result.bars.map((row) => row.id).reverse(),
    "Mobile labels must follow the same front-to-back stack as the timing rows",
  );
  const ordered = result.bars.slice().sort((left, right) => left.top - right.top);
  for (let index = 1; index < ordered.length; index += 1)
    assert(
      ordered[index].top >= ordered[index - 1].bottom,
      `Mobile component rows overlap at ${ordered[index].id}`,
    );
  assert(
    ordered.at(-1).bottom <= result.videoTop,
    "Mobile component rows must remain separate from the video row",
  );
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor();
  await page.waitForTimeout(1_200);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).click();

  await addComponent("Add a note", "Note");
  await addComponent("Show a message", "Message");
  await addComponent("Let viewers choose", "Choice");
  await assertSeparateMobileRows();

  await page.setViewportSize({ width: 320, height: 700 });
  await assertSeparateMobileRows();
  const preview = await page.locator(".pvBox").boundingBox();
  assert(
    preview && preview.height >= 100,
    "Stacked mobile rows must leave a usable preview on a small phone",
  );
  assert.deepEqual(errors, [], "The mobile layer stack should have no page errors");
  console.log("PASS: mobile component rows stay separate at phone widths.");
} finally {
  await context.close();
  await browser.close();
}
