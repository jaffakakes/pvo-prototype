import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";
import {
  fillGeneratedForm,
  openIndependentViewer,
} from "../cloud-agent-first-release/viewer.mjs";

async function visibleText(page, text) {
  for (const frame of page.frames()) {
    const matches = frame.getByText(text, { exact: false });
    for (const match of await matches.all())
      if (await match.isVisible()) return true;
  }
  return false;
}
async function requireVisible(page, text) {
  for (let index = 0; index < 100; index++) {
    if (await visibleText(page, text)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "The generated screen did not display expected saved text: " + text,
  );
}

/** The model has finished before test data is chosen; this never edits its source, agreement or component. */
export async function checkDurableDelivery(
  creator,
  fixture,
  directory,
  record,
) {
  const applied = await creator.apply();
  const form = applied.components.find((item) => item.type === "form");
  assert.ok(
    form?.serviceConnection,
    "The generated form must have its checked connection.",
  );
  const fields = form.code.pvoCompiled.structure.fields;
  const named = (pattern) =>
    fields.filter((field) => pattern.test(field.name + " " + field.label));
  const names = named(/name/i),
    messages = named(/message/i);
  assert.equal(names.length, 1, "Choose one unambiguous visitor name field.");
  assert.equal(
    messages.length,
    1,
    "Choose one unambiguous visitor message field.",
  );
  assert.notEqual(names[0].name, messages[0].name);
  assert.equal(fields.length, 2);
  const input = (name, message) => ({
    [names[0].name]: name,
    [messages[0].name]: message,
  });
  const page = creator.page;
  for (let number = 1; number <= 4; number++) {
    await page.evaluate(async () => {
      const state = window.resultProbe.useCapture.getState();
      state.patch({ t: 0 });
      (await import("/src/features/preview/tryMode.ts")).startTry();
      state.patch({ playing: false });
    });
    const reply = page.waitForResponse(
      (response) =>
        response.url().endsWith("/try") &&
        response.request().method() === "POST",
    );
    await fillGeneratedForm(
      page
        .locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]')
        .first()
        .contentFrame(),
      input(`TryVisitor${number}`, `TryMessage${number}`),
    );
    const response = await reply;
    assert.equal(response.status(), 200);
    const body = await response.json();
    await record("try_response", { number, body });
    await requireVisible(page, `TryVisitor${number}`);
    await requireVisible(page, `TryMessage${number}`);
    if (number === 4) {
      await requireVisible(page, "TryVisitor3");
      await requireVisible(page, "TryVisitor2");
      assert.equal(
        await visibleText(page, "TryVisitor1"),
        false,
        "Only the latest three entries should be shown.",
      );
      await page.screenshot({ path: directory + "/try-results.png" });
    }
    await page.evaluate(async () =>
      (await import("/src/features/preview/tryMode.ts")).stopTry(),
    );
  }
  await page.evaluate(async () =>
    (await import("/src/state/export/exportCommands.ts")).requestExport(),
  );
  await page
    .getByRole("dialog", { name: "Export", exact: true })
    .getByRole("button", { name: /Export and share/ })
    .click();
  const share = page.locator("[data-share-panel]");
  await share.waitFor();
  const downloadEvent = page.waitForEvent("download");
  await share.locator("[data-download-again]").click();
  const download = await downloadEvent;
  assert.equal(await download.failure(), null);
  const bytes = await readFile(await download.path());
  await writeFile(directory + "/generated.pvo", bytes, { mode: 0o600 });
  const packaged = await readPvoProject(new Blob([bytes]));
  assert.equal(
    packaged.validation.valid,
    true,
    JSON.stringify(packaged.validation.errors),
  );
  await record("export", {
    bytes: bytes.length,
    components: packaged.manifest.components.length,
  });
  const viewer = await openIndependentViewer(creator.browser, bytes);
  let publicCalls = 0;
  try {
    await viewer.context.route(
      creator.origin + "/api/services/**",
      async (route) => {
        const request = route.request();
        assert.equal((await request.allHeaders()).cookie, undefined);
        const response = await fixture.request(
          new URL(request.url()).pathname,
          {
            method: request.method(),
            session: null,
            headers: { Origin: viewer.origin },
            ...(request.postData() ? { body: request.postDataJSON() } : {}),
          },
        );
        assert.equal(
          response.status,
          request.method() === "OPTIONS" ? 204 : 200,
          JSON.stringify(response.body),
        );
        if (request.method() === "POST") {
          publicCalls++;
          await record("public_response", { body: response.body });
          assert.ok(
            !JSON.stringify(response.body).includes("TryVisitor"),
            "Try records must not enter live replies.",
          );
        }
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: response.body === null ? "" : JSON.stringify(response.body),
        });
      },
    );
    await fillGeneratedForm(viewer.frame, input("LiveVisitor", "LiveMessage"));
    await requireVisible(viewer.page, "LiveVisitor");
    await requireVisible(viewer.page, "LiveMessage");
    assert.equal(publicCalls, 1);
    await viewer.page.screenshot({ path: directory + "/viewer-results.png" });
    await fixture.restart();
    await viewer.page.reload();
    await viewer.page
      .locator("#pvoInput")
      .setInputFiles({
        name: "generated.pvo",
        mimeType: "application/vnd.pvo",
        buffer: bytes,
      });
    await viewer.page
      .getByRole("button", { name: "Show saved result", exact: true })
      .click();
    await requireVisible(viewer.page, "LiveVisitor");
    await requireVisible(viewer.page, "LiveMessage");
    assert.equal(
      publicCalls,
      1,
      "Showing a saved result must not repeat the write.",
    );
    assert.deepEqual(viewer.errors, []);
    await record("viewer_reopened", { publicCalls, errors: viewer.errors });
  } finally {
    await viewer.close();
  }
  assert.deepEqual(creator.errors, []);
}
