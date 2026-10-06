import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";
import { playerSourceAssets } from "../helpers/player-assets.mjs";
import { control } from "../../../tests/service-actions/helpers.mjs";
import { expectStatus } from "../../../tests/assistant-task-server/helpers.mjs";

/** Continues the real saved-result/Try fixture with normal export UI and a cookie-free second origin. */
export async function checkComponentDelivery({
  context,
  fixture,
  origin,
  page,
}) {
  const activations = [],
    errors = [];
  let failBeforeCommit = true,
    loseCommittedReply = true;
  const serviceRoutes = /\/api\/services\/service-[a-f0-9]{64}(\/activate)?$/;
  const serviceHandler = async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const body = request.postData() ? request.postDataJSON() : undefined;
    if (body) {
      activations.push(body);
      if (failBeforeCommit) {
        failBeforeCommit = false;
        await route.fulfill({
          status: 503,
          json: { error: "Temporary fixture failure" },
        });
        return;
      }
    }
    const result = await fixture.request(path, {
      method: request.method(),
      ...(body ? { body } : {}),
      headers: { Origin: origin },
    });
    expectStatus(result, 200);
    if (body && loseCommittedReply) {
      loseCommittedReply = false;
      await route.abort("connectionfailed");
    } else await route.fulfill({ status: result.status, json: result.body });
  };
  await context.route(serviceRoutes, serviceHandler);
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
  const assets = await playerSourceAssets();
  const server = createServer((request, response) => {
    const asset = assets.get(new URL(request.url, "http://local").pathname);
    response.writeHead(asset ? 200 : 404, {
      "Content-Type": asset?.type ?? "text/plain",
    });
    response.end(asset?.body ?? "Not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const viewerOrigin = `http://127.0.0.1:${server.address().port}`;
  const viewerContext = await context
    .browser()
    .newContext({ viewport: { width: 900, height: 900 } });
  try {
    const identity = await page.evaluate(async () => {
      const state = window.resultProbe.useCapture.getState();
      const identity = state.components[0].serviceConnection.receipt.identity;
      (await import("/src/state/export/exportCommands.ts")).requestExport();
      return identity;
    });
    const dialog = page.getByRole("dialog", { name: "Export", exact: true });
    await dialog.getByRole("button", { name: /Export and share/ }).click();
    await page
      .getByRole("heading", { name: "Export failed", exact: true })
      .waitFor();
    await page.evaluate(async () => {
      window.deliveryArtifact = (
        await import("/src/state/export/exportArtifactStore.ts")
      ).useExportArtifact.getState().prepared.artifact;
    });
    assert.equal(activations.length, 1);
    const lostReply = page.waitForEvent("requestfailed", {
      predicate: (request) =>
        new URL(request.url()).pathname.endsWith("/activate"),
    });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await lostReply;
    await page
      .getByRole("heading", { name: "Export failed", exact: true })
      .waitFor();
    assert.equal(activations.length, 2);
    assert.deepEqual(
      activations[0],
      activations[1],
      "Retry preserves the saved activation identity.",
    );
    await fixture.restart();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    const share = page.locator("[data-share-panel]");
    await share.waitFor();
    await share
      .getByText("Link sharing isn’t available yet.", { exact: true })
      .waitFor();
    assert.equal(
      activations.length,
      2,
      "Read-back recovers committed activation without another POST.",
    );
    assert(
      await page.evaluate(
        async () =>
          (
            await import("/src/state/export/exportArtifactStore.ts")
          ).useExportArtifact.getState().artifact === window.deliveryArtifact,
      ),
    );
    const downloadEvent = page.waitForEvent("download");
    await share.locator("[data-download-again]").click();
    const download = await downloadEvent;
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
    assert.equal(connection.releaseId, identity.resourceId);
    for (const key of [
      "ownerId",
      "projectId",
      "taskId",
      "reportDigest",
      "readiness",
      "receipt",
    ])
      assert(!JSON.stringify(packaged.manifest).includes(key), key);

    let publicCalls = 0;
    await viewerContext.route(origin + "/api/services/**", async (route) => {
      const request = route.request();
      assert.equal((await request.allHeaders()).cookie, undefined);
      const result = await fixture.request(new URL(request.url()).pathname, {
        method: request.method(),
        session: null,
        ...(request.postData() ? { body: request.postDataJSON() } : {}),
        headers: { Origin: viewerOrigin },
      });
      expectStatus(result, request.method() === "OPTIONS" ? 204 : 200);
      if (request.method() === "POST") publicCalls++;
      await route.fulfill({
        status: result.status,
        headers: Object.fromEntries(result.headers),
        body: result.body === null ? "" : JSON.stringify(result.body),
      });
    });
    const viewer = await viewerContext.newPage();
    viewer.on("pageerror", (error) => errors.push(error.message));
    await viewer.goto(viewerOrigin + "/player/");
    await viewer.locator("#pvoInput").setInputFiles({
      name: "downloaded.pvo",
      mimeType: "application/vnd.pvo",
      buffer: bytes,
    });
    const frame = viewer
      .locator('.component-position iframe[sandbox="allow-same-origin"]')
      .contentFrame();
    await frame.getByRole("textbox").fill("Live guest");
    await frame.getByRole("button", { name: "Join", exact: true }).click();
    await viewer
      .getByRole("button", { name: "Show saved result", exact: true })
      .waitFor();
    assert.equal(publicCalls, 1);
    const guests = await fixture.request(
      `/api/services/${identity.serviceId}/operate`,
      {
        body: {
          actionId: "inspect-export-guests",
          operation: "guests",
          input: null,
        },
      },
    );
    expectStatus(guests, 200);
    assert.deepEqual(
      guests.body.result,
      ["Live guest"],
      "Try records never enter the live service.",
    );
    // Reopen the same artifact with publication available. A paused service must stop reservation.
    const reservations = [],
      uploads = [];
    const publication = {
      id: "connected_delivery",
      url: origin + "/player/connected_delivery",
      status: "pending",
    };
    await context.route("**/api/publishing", (route) =>
      route.fulfill({
        json: { available: true, hasSession: true, maxBytes: 1000000000 },
      }),
    );
    await context.route("**/api/publications**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (path === "/api/publications" && request.method() === "POST") {
        reservations.push(request.postDataJSON());
        return route.fulfill({ status: 201, json: publication });
      }
      if (path.endsWith("/content")) {
        uploads.push(request.postDataBuffer());
        return route.fulfill({
          status: uploads.length === 1 ? 503 : 200,
          json:
            uploads.length === 1
              ? { error: "Temporary upload failure" }
              : { ...publication, status: "ready" },
        });
      }
      if (path.endsWith("/poster"))
        return route.fulfill({ json: { uploaded: true } });
      return route.fulfill({ json: { publications: [] } });
    });
    expectStatus(await control(fixture, { identity }, "pause"), 200);
    await share.locator("[data-share-done]").click();
    await page
      .locator("[data-export-share]")
      .filter({ visible: true })
      .first()
      .click();
    await share.getByText(/This service is paused or deleted/).waitFor();
    assert.equal(reservations.length, 0);
    expectStatus(await control(fixture, { identity }, "activate"), 200);
    await share
      .getByRole("button", { name: "Retry sharing", exact: true })
      .click();
    await share
      .getByText("Link sharing isn’t available yet.", { exact: true })
      .waitFor();
    await share
      .getByRole("button", { name: "Retry sharing", exact: true })
      .click();
    await share
      .getByRole("textbox", { name: "Published PVO link", exact: true })
      .waitFor();
    assert.equal(reservations.length, 2);
    assert.equal(
      reservations[0].idempotencyKey,
      reservations[1].idempotencyKey,
    );
    assert.deepEqual(
      uploads,
      [bytes, bytes],
      "Publication retries use the same activated file as download.",
    );
    assert.equal(
      activations.length,
      2,
      "Publication never repeats a recovered activation.",
    );
    const template = assets.get("/player/published.html").body.toString();
    const values = {
      TITLE: "Published connected PVO",
      PUBLICATION_ID: publication.id,
      CANONICAL_URL: publication.url,
      MEDIA_URL: origin + "/media/" + publication.id,
      POSTER_URL: "",
      FORMAT: "pvo",
      CONTENT_TYPE: "application/vnd.pvo",
      POSTER_META: "",
    };
    const publishedHtml = template.replace(
      /\{\{([A-Z_]+)\}\}/g,
      (_, name) => values[name],
    );
    await viewerContext.route(origin + "/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/")) return route.fallback();
      if (path === "/player/" + publication.id)
        return route.fulfill({ contentType: "text/html", body: publishedHtml });
      if (path === "/media/" + publication.id)
        return route.fulfill({
          contentType: "application/vnd.pvo",
          body: uploads[1],
        });
      const asset = assets.get(path);
      return route.fulfill({
        status: asset ? 200 : 404,
        contentType: asset?.type ?? "text/plain",
        body: asset?.body ?? "Not found",
      });
    });
    const publishedViewer = await viewerContext.newPage();
    publishedViewer.on("pageerror", (error) => errors.push(error.message));
    await publishedViewer.goto(publication.url);
    const publishedFrame = publishedViewer
      .locator('.component-position iframe[sandbox="allow-same-origin"]')
      .contentFrame();
    await publishedFrame.getByRole("textbox").fill("Another live guest");
    await publishedFrame
      .getByRole("button", { name: "Join", exact: true })
      .click();
    await publishedViewer
      .getByRole("button", { name: "Show saved result", exact: true })
      .waitFor();
    assert.equal(
      publicCalls,
      2,
      "The uploaded PVO invokes the same live service from the published player.",
    );
    const records = await fixture.control({
      action: "host-diagnostic",
      identity,
      kind: "inspect",
    });
    expectStatus(records, 200);
    assert(
      records.body.receipts.some(
        (row) =>
          row.namespace === "live" && JSON.parse(row.body).result === "full",
      ),
      "The published viewer sees the already occupied last place, independently of Try.",
    );
    assert.deepEqual(errors, []);
    await page.screenshot({ path: "/tmp/restyle-service-delivery.png" });
    await share.locator("[data-share-done]").click();
    await page
      .getByRole("button", { name: "Close export", exact: true })
      .click();
    console.log(
      "Connected export: real render/package, failed activation, exact retry, lost committed reply, Worker restart, download with publishing disabled, private-field exclusion, cookie-free cross-origin live submission, pause-gated publication and exact upload retry passed.",
    );
  } finally {
    await context.unroute(serviceRoutes, serviceHandler);
    await viewerContext.close();
    await new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    });
  }
}
