import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";

/** The normal export UI must preserve the background discriminator without any private receipt or key. */
export async function checkBackgroundDelivery({ context, page, service }) {
  await context.route("**/api/renders", (route) =>
    route.fulfill({
      json: {
        available: false,
        maxSourceBytes: 0,
        maxSources: 0,
        formats: [],
        qualities: [],
      },
    }),
  );
  await page.evaluate(async () =>
    (await import("/src/state/export/exportCommands.ts")).requestExport(),
  );
  const dialog = page.getByRole("dialog", { name: "Export", exact: true });
  await dialog.getByRole("button", { name: /Export and share/ }).click();
  const share = page.locator("[data-share-panel]");
  await share.waitFor();
  const event = page.waitForEvent("download");
  await share.locator("[data-download-again]").click();
  const download = await event;
  assert.equal(await download.failure(), null);
  const bytes = await readFile(await download.path());
  const packaged = await readPvoProject(new Blob([bytes]));
  assert.equal(
    packaged.validation.valid,
    true,
    JSON.stringify(packaged.validation.errors),
  );
  const connection =
    packaged.manifest.components[0].restyle_capture.service_connection;
  assert.equal(connection.releaseId, service.identity.resourceId);
  assert.equal(connection.operation.delivery, "background");
  for (const field of [
    "ownerId",
    "taskId",
    "receiptKey",
    "webhookSecret",
    "token",
  ])
    assert.ok(!JSON.stringify(packaged.manifest).includes(field));
  await page.evaluate(async () =>
    (await import("/src/state/captureStore.ts")).useCapture
      .getState()
      .patch({ sheet: null }),
  );
  console.log(
    "Normal background PVO export/download passed: checked release, public background operation and no private receipt/account key.",
  );
}
