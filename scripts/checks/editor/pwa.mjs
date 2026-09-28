import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { WebSocketServer, WebSocket } from "ws";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const buildDir = resolve(process.argv[2] || process.env.PVO_PWA_BUILD_DIR || resolve(root, "dist/editor"));
const captureScreenshots = process.env.PVO_PWA_SCREENSHOTS === "1";
const noticeScreenshot = resolve(tmpdir(), "restyle-beta-update-notice.png");
const mime = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

// Read only the checkpoint facts this journey needs; the stored project and
// binary media remain owned by the editor's persistence adapter.
async function readCheckpointInBrowser() {
  if (!indexedDB.databases || !(await indexedDB.databases()).some(database => database.name === "restyle-editor-project")) return null;
  return new Promise(resolve => {
    const opening = indexedDB.open("restyle-editor-project");
    opening.onerror = () => resolve(null);
    opening.onsuccess = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains("checkpoints") || !database.objectStoreNames.contains("media")) {
        database.close();
        resolve(null);
        return;
      }
      const transaction = database.transaction(["checkpoints", "media"], "readonly");
      const reading = transaction.objectStore("checkpoints").get("current");
      const media = transaction.objectStore("media").getAll();
      const mediaKeys = transaction.objectStore("media").getAllKeys();
      transaction.onerror = () => { database.close(); resolve(null); };
      transaction.oncomplete = () => {
        const checkpoint = reading.result;
        database.close();
        resolve(checkpoint && {
          version: checkpoint.version,
          ratio: checkpoint.project?.ratio,
          clips: checkpoint.project?.scenes?.flatMap(scene => scene.clips ?? []).map(clip => ({ id: clip.id, url: clip.url })),
          assetIds: checkpoint.assetIds,
          media: media.result.map((item, index) => ({
            id: String(mediaKeys.result[index]),
            size: item instanceof Blob ? item.size : item?.blob instanceof Blob ? item.blob.size : 0,
          })),
        });
      };
    };
  });
}

async function waitForCheckpoint(page, ready) {
  const deadline = Date.now() + 15000;
  let checkpoint = null;
  while (Date.now() < deadline) {
    checkpoint = await page.evaluate(readCheckpointInBrowser);
    if (ready(checkpoint)) return checkpoint;
    await page.waitForTimeout(200);
  }
  assert.fail(`The editor did not persist the expected checkpoint: ${JSON.stringify(checkpoint)}`);
}

const errors = [];
let serviceWorkerVersion = 0;
let workerRequests = 0;
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/editor/test-api") {
    response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    response.end("private response");
    return;
  }
  if (!pathname.startsWith("/editor/")) {
    response.writeHead(404).end();
    return;
  }
  const relativePath = pathname.slice("/editor/".length) || "index.html";
  if (relativePath === "sw.js") workerRequests += 1;
  const path = resolve(buildDir, relativePath);
  if (!path.startsWith(buildDir + sep)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const source = await readFile(path);
    const body = relativePath === "sw.js" && serviceWorkerVersion
      ? Buffer.concat([source, Buffer.from(`\n// update-check-${serviceWorkerVersion}\n`)])
      : source;
    const extension = path.slice(path.lastIndexOf("."));
    response.writeHead(200, {
      "Content-Type": mime[extension] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
const releaseSockets = new WebSocketServer({ server, path: "/api/releases/connect" });
const releaseMessage = () => JSON.stringify({ type: "release",
  revision: `restyle-editor-shell-${serviceWorkerVersion.toString(16).padStart(16, "0")}` });
releaseSockets.on("connection", socket => socket.send(releaseMessage()));
function announceRelease() {
  for (const socket of releaseSockets.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(releaseMessage());
  }
}
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("PWA check server failed to bind.");
const url = `http://127.0.0.1:${address.port}/editor/`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--use-fake-device-for-media-stream"],
});

try {
  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
    serviceWorkers: "allow",
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    const update = ServiceWorkerRegistration.prototype.update;
    window.__releaseChecks = 0;
    window.__releaseChecksPending = 0;
    ServiceWorkerRegistration.prototype.update = function (...args) {
      window.__releaseChecks += 1;
      window.__releaseChecksPending += 1;
      return update.apply(this, args).finally(() => { window.__releaseChecksPending -= 1; });
    };
  });
  const page = await context.newPage();
  let navigations = 0;
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.locator("#root .app").waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15000 });
  assert.equal(await page.getByText("New beta release", { exact: true }).isVisible(), false,
    "The initial install should not show a new-release prompt");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  assert.equal(manifestHref, "./manifest.json");
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').count(), 1);
  const manifestResponse = await page.request.get(new URL(manifestHref, url).href);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./?home=1", "Installed-app entry requests the mobile camera home");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512"]);
  for (const [icon, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    const image = await page.request.get(new URL(icon, url).href);
    assert.equal(image.status(), 200, `${icon} is missing`);
    assert.equal(image.headers()["content-type"], "image/png");
    const body = await image.body();
    assert.equal(body.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(body.readUInt32BE(16), size, `${icon} has the wrong width`);
    assert.equal(body.readUInt32BE(20), size, `${icon} has the wrong height`);
  }

  const cached = await page.evaluate(async () => {
    const name = (await caches.keys()).find(key => key.startsWith("restyle-editor-shell-"));
    if (!name) return [];
    return (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname);
  });
  for (const ending of ["/index.html", ".js", ".css", ".woff2", ".wasm"]) {
    assert(cached.some(path => path.endsWith(ending)), `${ending} was not precached`);
  }
  assert(cached.every(path => path.startsWith("/editor/")), "PWA cached a resource outside the editor");
  assert.equal(await page.evaluate(() => fetch("./test-api").then(response => response.text())), "private response");
  const apiCached = await page.evaluate(async () => {
    const name = (await caches.keys()).find(key => key.startsWith("restyle-editor-shell-"));
    return (await (await caches.open(name)).keys()).some(request => request.url.includes("test-api"));
  });
  assert.equal(apiCached, false, "An API response entered the app-shell cache");

  const navigationsBeforeUpdate = navigations;
  // Let the initial connection's replay finish before simulating a new build.
  await page.waitForFunction(() => window.__releaseChecks > 0 && window.__releaseChecksPending === 0);
  const requestsBeforeRelease = workerRequests;
  serviceWorkerVersion = 1;
  // No polling: changing the server's build alone must not trigger a fetch.
  await page.waitForTimeout(17000);
  assert.equal(workerRequests, requestsBeforeRelease, "The editor polled without a release event");
  assert.equal(await page.getByText("New beta release", { exact: true }).isVisible(), false);
  announceRelease();
  await page.getByText("New beta release", { exact: true }).waitFor({ timeout: 10000 });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.waiting && !registration.installing);
  });
  await page.getByText("New beta release", { exact: true }).waitFor();
  if (captureScreenshots) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: noticeScreenshot });
  }
  await page.waitForTimeout(300);
  assert.equal(navigations, navigationsBeforeUpdate, "A waiting update reloaded the app before consent");
  assert.equal(await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.waiting && registration.active === navigator.serviceWorker.controller);
  }), true, "The new worker took over before Update was pressed");

  const reload = page.waitForEvent("load", { timeout: 15000 });
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await reload;
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active && !registration.waiting && registration.active === navigator.serviceWorker.controller);
  });
  assert.equal(navigations, navigationsBeforeUpdate + 1, "Update should reload the app once");
  await page.locator("#root .app").waitFor();

  const navigationsBeforeProjectUpdate = navigations;
  await page.evaluate(() => {
    window.__oldPwaController = navigator.serviceWorker.controller;
    window.__pwaControllerChanges = 0;
    navigator.serviceWorker.addEventListener("controllerchange", () => { window.__pwaControllerChanges += 1; });
  });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor();
  serviceWorkerVersion = 2;
  // Miss the broadcast while disconnected: reconnect must replay the latest ID.
  for (const socket of releaseSockets.clients) socket.terminate();
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.waiting && !registration.installing);
  });
  if (await page.getByText("New beta release", { exact: true }).isVisible()) {
    assert.equal(await page.getByRole("button", { name: "Update", exact: true }).isEnabled(), false,
      "The release prompt should not be actionable while recording");
  }
  assert.equal(navigations, navigationsBeforeProjectUpdate, "Recording was interrupted by an update");
  const recordingWorkers = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      waiting: Boolean(registration?.waiting),
      activeIsController: registration?.active === navigator.serviceWorker.controller,
      activeIsOld: registration?.active === window.__oldPwaController,
      controllerIsOld: navigator.serviceWorker.controller === window.__oldPwaController,
      controllerChanges: window.__pwaControllerChanges,
      activeState: registration?.active?.state,
      controllerState: navigator.serviceWorker.controller?.state,
      installingState: registration?.installing?.state,
    };
  });
  assert.equal(recordingWorkers.activeIsController && recordingWorkers.activeIsOld
    && recordingWorkers.controllerIsOld && recordingWorkers.controllerChanges === 0, true,
    `The update took over an active recording: ${JSON.stringify(recordingWorkers)}`);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).waitFor();
  await page.getByText("New beta release", { exact: true }).waitFor();
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));

  await page.getByRole("button", { name: "Ratio", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "1:1" }).click();
  assert.equal(await page.getByRole("button", { name: "Ratio", exact: true }).getAttribute("aria-description"),
    "Selected: 1:1", "The project ratio edit should be visible before updating");
  const original = await waitForCheckpoint(page, checkpoint => checkpoint?.ratio === "1:1"
    && checkpoint.clips?.length === 1 && checkpoint.media?.length === 1 && checkpoint.media[0].size > 0);
  assert.equal(original.version, 2, "The saved project should have a versioned format");
  assert.equal(original.assetIds?.length, 1, "The checkpoint should reference the recorded asset");
  assert.equal(original.clips[0].url, original.assetIds[0],
    "The recorded clip must reference its saved asset ID");
  assert.ok(original.media.some(item => item.id === original.clips[0].url),
    "The recorded clip must reference its saved binary media");

  const projectReload = page.waitForEvent("load", { timeout: 15000 });
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await projectReload;
  assert.equal(await page.getByRole("button", { name: "Update anyway" }).count(), 0,
    "The app should not ask for an extra update confirmation");
  assert.equal(navigations, navigationsBeforeProjectUpdate + 1, "Update should reload once with saved work");
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active && !registration.waiting && registration.active === navigator.serviceWorker.controller);
  });
  await page.locator("#root .app").waitFor();
  await page.getByRole("button", { name: "Open editor" }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole("button", { name: "Ratio", exact: true }).getAttribute("aria-description"),
    "Selected: 1:1", "The project ratio edit disappeared after the update");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor();
  await page.waitForTimeout(450);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).locator(".dockCount").getByText("2").waitFor();
  const continued = await waitForCheckpoint(page, checkpoint => checkpoint?.ratio === "1:1"
    && checkpoint.clips?.length === 2 && checkpoint.media?.length === 2 && checkpoint.media.every(item => item.size > 0));
  assert.equal(continued.clips[0].id, original.clips[0].id,
    "The original take should remain after recording again on the updated app");
  assert.equal(new Set(continued.clips.map(clip => clip.id)).size, 2,
    "New takes after restore must receive distinct clip IDs");
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.getByRole("heading", { name: "Edit" }).waitFor();
  await page.waitForFunction(() => {
    const video = document.querySelector(".pvVideo");
    return video instanceof HTMLVideoElement && video.videoWidth > 0 && video.readyState >= 2;
  }, undefined, { timeout: 15000 });

  await page.getByRole("button", { name: "Back to camera" }).click();
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("dialog", { name: "Start over?" }).getByRole("button", { name: "Discard" }).click();
  // Deliberately reload immediately after Discard. The reset must win even if
  // its asynchronous IndexedDB cleanup has not completed yet.
  await page.reload({ waitUntil: "load" });
  await page.locator("#root .app").waitFor();
  await page.waitForTimeout(700);
  assert.equal(await page.getByRole("button", { name: "Open editor" }).count(), 0,
    "A discarded project returned after a quick restart");
  assert.equal(await page.getByText("No clips yet", { exact: true }).isVisible(), true,
    "The discarded project should restore as a clean camera");

  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });
  await page.locator("#root .app").waitFor();
  assert.equal(await page.title(), "Restyle Capture");
  assert.equal(await page.getByRole("button", { name: "Open editor" }).count(), 0,
    "A discarded project returned on an offline restart");

  // If browser storage is unavailable, an in-progress take must stay in the
  // current tab instead of letting an update reload and silently lose it.
  serviceWorkerVersion = 3;
  const failureContext = await browser.newContext({
    permissions: ["camera", "microphone"],
    serviceWorkers: "allow",
    viewport: { width: 390, height: 844 },
  });
  try {
    await failureContext.addInitScript(() => {
      window.__blockedStorageOpens = 0;
      Object.defineProperty(indexedDB, "open", {
        configurable: true,
        value() {
          window.__blockedStorageOpens += 1;
          throw new DOMException("Simulated browser storage denial", "QuotaExceededError");
        },
      });
    });
    const failurePage = await failureContext.newPage();
    let failureNavigations = 0;
    failurePage.on("framenavigated", frame => {
      if (frame === failurePage.mainFrame()) failureNavigations += 1;
    });
    failurePage.on("pageerror", error => errors.push(error.message));
    await failurePage.goto(url, { waitUntil: "load" });
    await failurePage.locator("#root .app").waitFor();
    await failurePage.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15000 });
    await failurePage.getByRole("button", { name: "Record", exact: true }).click();
    await failurePage.getByRole("button", { name: "Stop recording" }).waitFor();
    await failurePage.waitForTimeout(450);
    await failurePage.getByRole("button", { name: "Stop recording" }).click();
    await failurePage.getByRole("button", { name: "Open editor" }).waitFor();
    assert.ok(await failurePage.evaluate(() => window.__blockedStorageOpens) > 0,
      "The denied-storage fixture did not exercise the persistence adapter");

    const beforeUnsafeUpdate = failureNavigations;
    serviceWorkerVersion = 4;
    announceRelease();
    await failurePage.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
    const unsafeUpdate = failurePage.getByRole("button", { name: "Update", exact: true });
    if (await unsafeUpdate.isVisible() && await unsafeUpdate.isEnabled()) await unsafeUpdate.click();
    await failurePage.waitForTimeout(1200);
    assert.equal(failureNavigations, beforeUnsafeUpdate,
      "Restyle restarted despite being unable to save the recorded take");
    assert.equal(await failurePage.getByRole("button", { name: "Open editor" }).isVisible(), true,
      "A failed save removed the current take");
    assert.equal(await failurePage.getByRole("button", { name: "Update anyway" }).count(), 0,
      "A failed save should not offer an unsafe confirmation bypass");
  } finally {
    await failureContext.close();
  }

  assert.equal(errors.length, 0, `PWA page errors: ${errors.join("; ")}`);
  console.log("Editor PWA passed: install metadata/icons, scoped static precache, API excluded, release prompt, saved-project update and restored video, distinct IDs after restart, quick discard stays cleared, offline app shell, blocked unsafe update on storage failure.");
  if (captureScreenshots) console.log(`PWA screenshot: ${noticeScreenshot}`);
} finally {
  await browser.close();
  for (const socket of releaseSockets.clients) socket.terminate();
  await new Promise(resolve => releaseSockets.close(resolve));
  await new Promise(resolve => server.close(resolve));
}
