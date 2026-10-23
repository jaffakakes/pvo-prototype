import assert from "node:assert/strict";
import { createServer } from "node:http";
import { playerSourceAssets } from "../helpers/player-assets.mjs";

export async function fillGeneratedForm(frame, fields) {
  for (const [name, value] of Object.entries(fields)) {
    const field = frame.locator(`[name="${name}"]`);
    await field.first().waitFor();
    assert.equal(
      await field.count(),
      1,
      `Generated form field missing: ${name}`,
    );
    if (typeof value === "boolean") await field.setChecked(value);
    else await field.fill(String(value));
  }
  await frame.locator('button[type="submit"]').click();
}

/** A different origin and browser storage partition loads the actual exported bytes. */
export async function openIndependentViewer(browser, bytes, publication) {
  const assets = await playerSourceAssets();
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://local").pathname;
    if (publication && path === "/media/" + publication.id) {
      response.writeHead(200, { "Content-Type": "application/vnd.pvo" });
      return response.end(publication.bytes);
    }
    if (publication && path === "/player/" + publication.id) {
      const values = {
        TITLE: "Generated acceptance component",
        PUBLICATION_ID: publication.id,
        CANONICAL_URL: origin + path,
        MEDIA_URL: origin + "/media/" + publication.id,
        POSTER_URL: "",
        FORMAT: "pvo",
        CONTENT_TYPE: "application/vnd.pvo",
        POSTER_META: "",
      };
      const html = assets
        .get("/player/published.html")
        .body.toString()
        .replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key]);
      response.writeHead(200, { "Content-Type": "text/html" });
      return response.end(html);
    }
    const asset = assets.get(path);
    response.writeHead(asset ? 200 : 404, {
      "Content-Type": asset?.type ?? "text/plain",
    });
    response.end(asset?.body ?? "Not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({
    viewport: { width: 900, height: 900 },
  });
  const errors = [];
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(origin + "/player/");
    await page.locator("#pvoInput").setInputFiles({
      name: "generated.pvo",
      mimeType: "application/vnd.pvo",
      buffer: bytes,
    });
    const frame = page
      .locator('.component-position iframe[sandbox="allow-same-origin"]')
      .contentFrame();
    return {
      context,
      page,
      frame,
      origin,
      errors,
      assets,
      openPublished: async () => {
        assert.ok(publication);
        await page.goto(origin + "/player/" + publication.id);
        return page
          .locator('.component-position iframe[sandbox="allow-same-origin"]')
          .contentFrame();
      },
      close: async () => {
        await context.close();
        await new Promise((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        });
      },
    };
  } catch (error) {
    await context.close();
    server.close();
    throw error;
  }
}
