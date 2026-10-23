import assert from "node:assert/strict";
import { createBrowserFixture } from "../helpers/browser.mjs";
import { playerSourceAssets } from "../helpers/player-assets.mjs";

const assets = await playerSourceAssets();
assets.set("/", {
  type: "text/html",
  body: '<!doctype html><title>Isolated form fixture</title><main id="host"></main>',
});
const fixture = await createBrowserFixture(assets);
const page = await fixture.context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(fixture.origin);
  await page.evaluate(async () => {
    const { mountCustomComponent } =
      await import("/packages/pvo-code-runtime/index.js");
    const { compilePvoComponent } =
      await import("/packages/pvo-language/index.js");
    const compiled = await compilePvoComponent("form", {
      structure:
        '<form><heading>Your reply</heading><field name="reply" kind="short" label="Reply" /><submit>Send reply</submit></form>',
      style: "field { color: #111111; }",
      logic: "on submit { continue(); }",
    });
    window.actions = [];
    window.handle = mountCustomComponent(document.getElementById("host"), {
      componentId: "reply",
      ...compiled,
      interactive: true,
      onAction: (action) => window.actions.push(action),
      onError: (error) => {
        throw new Error(error);
      },
    });
  });
  const form = page.frameLocator('iframe[sandbox="allow-same-origin"]');
  const input = form.getByRole("textbox", { name: "Reply", exact: true });
  const send = form.getByRole("button", { name: "Send reply", exact: true });
  await input.waitFor();
  assert.equal(await input.getAttribute("maxlength"), "1024");
  await page.waitForTimeout(400);
  for (const length of [500, 501, 700, 1024]) {
    await input.fill("a".repeat(length));
    const before = await page.evaluate(() => window.actions.length);
    await send.click();
    await page.waitForFunction(
      (count) => window.actions.length > count,
      before,
    );
    assert.equal(
      await page.evaluate(() => window.actions.at(-1).args[0].reply.length),
      length,
    );
  }
  await input.evaluate((element) => {
    element.value = "a".repeat(1025);
  });
  const before = await page.evaluate(() => window.actions.length);
  await send.click();
  assert.equal(await page.evaluate(() => window.actions.length), before);
  assert.match(
    await input.evaluate((element) => element.validationMessage),
    /1024/,
  );
  assert.equal(
    (await input.inputValue()).length,
    1025,
    "Invalid data is preserved for correction",
  );
  await input.fill("Corrected");
  await send.click();
  await page.waitForFunction((count) => window.actions.length > count, before);
  assert.equal(
    await page.evaluate(() => window.actions.at(-1).args[0].reply),
    "Corrected",
  );
  const native = await page.evaluate(async () => {
    const { formValuesForComponent } =
      await import("/player/actions/form-values.js");
    const component = {
      kind: "form",
      fields: [{ name: "reply", type: "text" }],
      restyle_capture: { form: true },
    };
    const result = [500, 501, 700, 1024].map(
      (length) =>
        formValuesForComponent(component, { reply: "b".repeat(length) }).reply
          .length,
    );
    try {
      formValuesForComponent(component, { reply: "b".repeat(1025) });
      return null;
    } catch {
      return result;
    }
  });
  assert.deepEqual(native, [500, 501, 700, 1024]);
  await page.evaluate(() => window.handle.destroy());
  assert.deepEqual(errors, []);
  console.log(
    "PASS: compiled/native replies preserve 500/501/700/1024 characters, visibly reject 1025 and recover after correction",
  );
} finally {
  await fixture.close();
}
