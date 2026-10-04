import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const videoBytes = await readFile(videoFile);
const screenshots = await mkdtemp(join(tmpdir(), "restyle-create-project-"));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const errors = [];
const desktop = page => page.locator("[data-desktop-editor]");
const clips = page => page.locator("[data-desktop-timeline]").getByRole("button", { name: /^Clip \d+,/ });

const templateIds = ["talking-head", "product-drop", "choose-your-path", "travel-recap", "podcast-clip", "tutorial"];
const templateMeta = [
  "2 scenes · 0:30",
  "Message actions · 3 scenes",
  "Choice branching · 3 scenes",
  "Scene routing · 5 scenes",
  "Timeline jump · 1 scene",
  "Local form · 3 scenes",
];
const templateColours = ["#4A2A3E", "#1F3D33", "#2B2347", "#4A3B23", "#23404A", "#3A2A1F"];

async function gridTracks(gallery) {
  return gallery.locator('[role="tabpanel"]').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
}

async function waitForCards(gallery, count) {
  await gallery.page().waitForFunction(({ selector, count: expected }) =>
    document.querySelector(selector)?.querySelectorAll("[data-template-card]").length === expected,
  { selector: "[data-template-gallery]", count });
}

async function assertTemplateGallery(page, width) {
  const gallery = page.locator("[data-template-gallery]");
  const previews = gallery.locator("[data-template-preview]");
  assert.equal(await previews.count(), 6);
  assert.equal(await gallery.locator("video, img").count(), 0, "Template hints must not borrow still or moving media");
  assert.equal(await gallery.getByText("PVO sample", { exact: false }).count(), 0);
  assert.equal(await gallery.locator("[data-template-card]").count(), 6);
  assert.deepEqual(await gallery.locator("[data-template-card]").evaluateAll(cards => cards.map(card => card.getAttribute("data-template-card"))), templateIds);
  assert.deepEqual(await gallery.locator("[data-template-card] [id$='-meta']").allTextContents(), templateMeta);
  assert.deepEqual(await gallery.locator("[data-template-poster]").evaluateAll(posters => posters.map(poster =>
    getComputedStyle(poster).getPropertyValue("--poster").trim().toUpperCase())), templateColours);
  assert.equal(await gallery.locator("[data-template-poster]").first().evaluate(poster =>
    getComputedStyle(poster, "::before").backgroundImage.startsWith("repeating-linear-gradient")), true);
  assert.equal(await gallery.locator("[data-template-preview]").evaluateAll(nodes => nodes.every(node =>
    getComputedStyle(node).backgroundImage === "none"
      && [node, ...node.querySelectorAll("*")].every(element => getComputedStyle(element).filter === "none"))), true,
  "Ghost frames must stay free of scenic gradients, blur and glow effects");

  const dimensions = await previews.evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return [node.getAttribute("data-ratio"), Math.round(box.width), Math.round(box.height)];
  }));
  assert.deepEqual(dimensions, [
    ["9:16", 64, 114], ["9:16", 64, 114], ["9:16", 64, 114],
    ["9:16", 64, 114], ["1:1", 92, 92], ["16:9", 132, 74],
  ]);
  assert.equal(await previews.evaluateAll(nodes => nodes.every(node => {
    const animations = node.getAnimations({ subtree: true });
    return animations.length > 0 && animations.every(animation => {
      const timing = animation.effect?.getTiming();
      const target = animation.effect?.target;
      const style = target instanceof Element ? getComputedStyle(target) : null;
      return animation.playState === "running" && timing?.duration === 3600
        && timing.iterations === Infinity && timing.delay === 0
        && style?.animationDuration === "3.6s" && style.animationTimingFunction === "ease-in-out"
        && style.animationIterationCount === "infinite" && style.animationDelay === "0s";
    });
  })), true, "Every ghost hint should run only its 3.6 second loop");

  assert.equal(await gallery.locator("h2").evaluate(heading => getComputedStyle(heading.parentElement).alignItems), "baseline");
  const tablist = gallery.getByRole("tablist", { name: "Filter templates" });
  await tablist.waitFor();
  assert.deepEqual(await tablist.getByRole("tab").allTextContents(), ["All templates", "Portrait", "Square", "Landscape", "Interactive"]);
  assert.equal(await tablist.getByRole("tab", { name: "All templates" }).getAttribute("aria-selected"), "true");
  assert.equal(await gallery.getByText("6 templates", { exact: true }).count(), 1);
  assert.equal(await gallery.getByRole("button", { name: "Browse all", exact: true }).count(), 1);
  assert.equal(await tablist.getByRole("tab").first().evaluate(tab => Math.round(tab.getBoundingClientRect().height)), 36);
  assert.match(await tablist.getByRole("tab").first().evaluate(tab => getComputedStyle(tab).boxShadow), /rgb\(255, 45, 120\)/);
  assert.equal(await gridTracks(gallery), width < 1200 ? 4 : 6);

  if (width < 1200) {
    await tablist.getByRole("tab", { name: "Square" }).click();
    await waitForCards(gallery, 1);
    assert.equal(await gridTracks(gallery), 4);
    await tablist.getByRole("tab", { name: "All templates" }).click();
    await waitForCards(gallery, 6);
  }

  if (width >= 1200 && width < 1400) {
    await tablist.getByRole("tab", { name: "Interactive" }).click();
    await waitForCards(gallery, 5);
    assert.equal(new URL(page.url()).searchParams.get("filter"), "interactive");
    assert.equal(new URL(page.url()).searchParams.get("home"), "1");
    assert.equal(await gallery.getByText("5 templates", { exact: true }).count(), 1);
    assert.equal(await gridTracks(gallery), 5);
    assert.deepEqual(await gallery.locator("[data-template-card]").evaluateAll(cards => cards.map(card => card.getAttribute("data-template-card"))), templateIds.slice(1));

    await tablist.getByRole("tab", { name: "Square" }).click();
    await waitForCards(gallery, 1);
    assert.equal(await gallery.getByText("1 template", { exact: true }).count(), 1);
    assert.equal(await gridTracks(gallery), 5);
    assert.deepEqual(await gallery.locator("[data-template-card]").evaluateAll(cards => cards.map(card => card.getAttribute("data-template-card"))), ["podcast-clip"]);

    await gallery.getByRole("button", { name: "Close filters" }).click();
    await waitForCards(gallery, 6);
    assert.equal(new URL(page.url()).searchParams.has("filter"), false);
    assert.equal(new URL(page.url()).searchParams.get("home"), "1");
    assert.equal(await gallery.getByRole("tablist", { name: "Filter templates" }).count(), 0);
    assert.equal(await gallery.getByRole("button", { name: "Show filters" }).count(), 1);
    await gallery.getByRole("button", { name: "Show filters" }).click();
    assert.equal(await gallery.getByRole("tab", { name: "All templates" }).getAttribute("aria-selected"), "true");
  }
}

async function saved(page, id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(async projectId => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("restyle-editor-project");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const record = await new Promise((resolve, reject) => {
        const request = database.transaction("checkpoints").objectStore("checkpoints").get(`project:${projectId}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return record?.localId === projectId;
    } finally { database.close(); }
    }, id);
    if (ready) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`Project ${id} was not saved`);
}

const oldChoice = {
  id: "choice", type: "choice", sceneId: "main", at: 0, dur: 2, x: 50, y: 50,
  branchAtEnd: true,
  fields: { prompt: "Choose", options: [
    { label: "A", outcome: { kind: "continue" } },
    { label: "B", outcome: { kind: "continue" } },
  ] },
};

function checkpoint(id, components = [], assetIds = []) {
  return {
    version: 3,
    localId: id,
    projectName: id === "legacy-project" ? "Legacy edit" : "Keep me",
    savedAt: Date.now(),
    project: {
      scenes: [{ id: "main", name: "Main", parent: null, clips: [], texts: [], components, muted: false, sound: 0 }],
      currentSceneId: "main", ratio: "9:16", coverAt: 0, allowedDomains: [],
    },
    past: [], future: [], assetIds,
    resume: { screen: "editor", t: 0, sel: 0, selComp: null, selText: null, exportFormat: "video", quality: "1080p" },
  };
}

async function seedProjectStorage(page, checkpoints, mediaIds) {
  await page.goto(new URL("./restyle-mark.png", editorUrl).href);
  await page.evaluate(async ({ checkpoints: records, mediaIds: ids }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("restyle-editor-project", 2);
      request.onupgradeneeded = () => {
        const value = request.result;
        if (!value.objectStoreNames.contains("checkpoints")) value.createObjectStore("checkpoints");
        if (!value.objectStoreNames.contains("media")) value.createObjectStore("media");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["checkpoints", "media"], "readwrite");
    for (const [key, record] of records) transaction.objectStore("checkpoints").put(record, key);
    for (const id of ids) transaction.objectStore("media").put(new Blob([id]), id);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { checkpoints, mediaIds });
}

async function inspectProjectStorage(page, checkpointKeys, mediaKeys) {
  return page.evaluate(async ({ checkpointKeys: recordKeys, mediaKeys: assetKeys }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("restyle-editor-project");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["checkpoints", "media"], "readonly");
    const complete = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
    const read = (store, key) => new Promise((resolve, reject) => {
      const request = transaction.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const checkpointReads = recordKeys.map(key => read("checkpoints", key));
    const mediaReads = assetKeys.map(key => read("media", key));
    const [checkpoints, media] = await Promise.all([Promise.all(checkpointReads), Promise.all(mediaReads)]);
    await complete;
    database.close();
    return { checkpointIds: checkpoints.map(value => value?.localId ?? null), media: media.map(Boolean) };
  }, { checkpointKeys, mediaKeys });
}

async function run(width) {
  const height = width === 1024 ? 768 : 900;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 1024, reducedMotion: "no-preference" });
  let signedIn = false;
  const origin = new URL(editorUrl).origin;
  await context.route(`${origin}/api/auth/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") return route.fulfill({ contentType: "application/json",
      body: JSON.stringify({ available: true, clerkAvailable: false, clerkPublishableKey: null, canLinkEmail: false, emailLinked: false, user: signedIn ? { id: "editor-test", name: "Editor tester" } : null }) });
    if (path === "/api/auth/google/start") {
      signedIn = true;
      return route.fulfill({ contentType: "text/html",
        body: `<script>window.opener.postMessage({type:"pvo:auth:complete",ok:true},${JSON.stringify(origin)});window.close()</script>` });
    }
    throw new Error(`Unexpected account operation ${path}`);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
  await page.route("**/api/publishing", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: false, hasSession: false, maxBytes: 0 }) }));
  try {
    const home = new URL(editorUrl);
    home.search = "?home=1";
    await page.goto(home.href);
    await page.getByRole("heading", { name: "Start a new edit" }).waitFor();
    await page.locator("#restyle-launch-splash").waitFor({ state: "detached" });
    await assertTemplateGallery(page, width);
    assert.equal(await page.getByRole("button", { name: "Resume", exact: false }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Start editing", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(screenshots, `create-${width}.png`) });
    await page.getByLabel("Upload video files").setInputFiles(videoFile);
    await page.getByLabel("Project name", { exact: true }).fill("My first edit");
    await page.getByRole("radio", { name: "4:5", exact: true }).check();
    await page.getByRole("button", { name: "Start editing", exact: true }).click();
    await desktop(page).waitFor();
    const firstUrl = page.url();
    const firstId = new URL(firstUrl).searchParams.get("project");
    assert.ok(firstId);
    assert.equal(await clips(page).count(), 1);
    await saved(page, firstId);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("dialog", { name: "Create a free account", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const exportDialog = page.getByRole("dialog", { name: "Export", exact: true });
    await exportDialog.waitFor();
    await exportDialog.getByRole("button", { name: /Export video/ }).click();
    const auth = page.getByRole("dialog", { name: "Create a free account to export", exact: true });
    await auth.waitFor();
    const popup = page.waitForEvent("popup");
    await auth.getByRole("button", { name: "Continue with Google" }).click();
    await popup;
    await auth.waitFor({ state: "hidden" });
    await page.getByRole("dialog", { name: "Export", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(page.url(), firstUrl);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(page.url(), firstUrl, "Resizing must never change project routes");
    await page.getByRole("button", { name: "Back to camera" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Export", exact: true }).count(), 0, "Phone keeps its original header");
    await page.setViewportSize({ width: 1024, height: 1200 });
    await page.getByRole("button", { name: "Back to camera" }).waitFor();
    assert.equal(await desktop(page).count(), 0, "Portrait keeps the existing editor");
    assert.equal(page.url(), firstUrl, "Changing orientation must retain the project route");
    await page.setViewportSize({ width, height });
    await page.reload();
    await desktop(page).waitFor();
    await page.getByRole("heading", { name: "My first edit", exact: true }).waitFor();
    assert.equal(await clips(page).count(), 1);
    const restoredBytes = await clips(page).first().locator("video").evaluate(async video => Array.from(new Uint8Array(await (await fetch(video.src)).arrayBuffer())));
    assert.deepEqual(Buffer.from(restoredBytes), videoBytes, "Recovery must retain the exact media bytes");
    await page.getByRole("button", { name: "Back to projects" }).click();
    await page.getByRole("button", { name: "Resume", exact: false }).waitFor();
    await page.getByRole("button", { name: "Blank project", exact: true }).click();
    await desktop(page).waitFor();
    const secondId = new URL(page.url()).searchParams.get("project");
    assert.notEqual(firstId, secondId);
    assert.equal(await clips(page).count(), 0);
    await saved(page, secondId);
    await page.goBack();
    await page.getByRole("heading", { name: "Start a new edit" }).waitFor();
    await page.goBack();
    await page.getByRole("heading", { name: "My first edit", exact: true }).waitFor();
    assert.equal(await clips(page).count(), 1, "New projects must not delete older footage");
    await page.getByRole("button", { name: "Back to projects" }).click();
    await page.getByRole("tab", { name: "Interactive", exact: true }).click();
    await waitForCards(page.locator("[data-template-gallery]"), 5);
    await page.getByRole("button", { name: "Use Choose your path template" }).click();
    await page.getByRole("heading", { name: "Choose your path", exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.has("filter"), false, "Project routes must not retain gallery filters");
    assert.equal(await page.evaluate(() => localStorage.getItem("restyle.editor.advancedEditing")), "true");
    assert.equal(await clips(page).count(), 1);
    await page.getByRole("button", { name: "choice: Choose your path", exact: true }).click();
    await page.getByRole("tab", { name: "Advanced", exact: true }).click();
    assert.match(await page.getByLabel("Structure source").inputValue(), /<choice>/);
    await page.getByRole("tab", { name: "Logic", exact: true }).click();
    assert.match(await page.getByLabel("Logic source").inputValue(), /go_to_scene/);
    await page.getByRole("tab", { name: "Components", exact: true }).waitFor();
    await page.screenshot({ path: join(screenshots, `editor-${width}.png`) });
  } catch (error) {
    await page.screenshot({ path: join(screenshots, `failure-${width}.png`) }).catch(() => {});
    console.error((await page.locator("body").innerText()).slice(0, 1500));
    throw error;
  } finally { await context.close(); }
}

async function dropVariant() {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  const url = new URL(editorUrl);
  url.search = "?home=1&drop";
  await page.goto(url.href);
  await page.getByRole("heading", { name: "Drop clips to start editing" }).waitFor();
  assert.equal(await page.getByText("AI video studio", { exact: false }).count(), 0);
  await page.getByText("Free · no sign-up", { exact: false }).waitFor();
  const transfer = await page.evaluateHandle(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "dropped-video.mp4", { type: "video/mp4" }));
    return transfer;
  }, Array.from(videoBytes));
  await page.locator("header").dispatchEvent("drop", { dataTransfer: transfer });
  await page.getByRole("heading", { name: "Clips are in — set up your edit" }).waitFor();
  assert.equal(await page.getByLabel("Project name", { exact: true }).inputValue(), "dropped video");
  await page.getByRole("radio", { name: "1:1", exact: true }).check();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("button", { name: "Start editing", exact: true }).click();
  await desktop(page).waitFor();
  assert.equal(await clips(page).count(), 1);
  assert.match(await page.getByRole("button", { name: "Project settings" }).innerText(), /1:1/);
  await context.close();
}

async function stagedResize() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  const url = new URL(editorUrl);
  url.search = "?home=1&template=podcast-clip";
  await page.goto(url.href);
  assert.equal(await page.getByLabel("Project name", { exact: true }).inputValue(), "Podcast clip");
  await page.getByLabel("Upload video files").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not video") });
  await page.getByRole("alert").filter({ hasText: "isn't a supported video" }).waitFor();
  await page.getByLabel("Upload video files").setInputFiles(videoFile);
  await page.getByText("Clips are ready", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".camWrap").waitFor();
  assert.equal(await page.getByRole("heading", { name: "Start a new edit" }).count(), 0);
  assert.equal(page.url(), url.href);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("heading", { name: "Start a new edit" }).waitFor();
  assert.equal(await page.getByLabel("Project name", { exact: true }).inputValue(), "Podcast clip");
  await page.getByText("Clips are ready", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Start editing", exact: true }).click();
  await desktop(page).waitFor();
  assert.equal(await clips(page).count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Back to camera" }).click();
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.waitForURL(current => !current.searchParams.has("project"));
  await page.reload();
  await page.locator(".camWrap").waitFor();
  assert.equal(await page.getByRole("button", { name: "Open editor", exact: true }).count(), 0, "Discarded project must not return after reload");
  await context.close();
}

async function recoveryDiscard() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route("**/api/publishing", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: false, hasSession: false, maxBytes: 0 }) }));
  const legacy = checkpoint("legacy-project", [oldChoice], ["asset:legacy", "asset:shared"]);
  await seedProjectStorage(page, [
    ["current", legacy],
    ["project:legacy-project", legacy],
    ["project:kept-project", checkpoint("kept-project", [], ["asset:kept", "asset:shared"])],
  ], ["asset:legacy", "asset:kept", "asset:shared"]);

  const home = new URL(editorUrl);
  home.search = "?home=1";
  await page.goto(home.href);
  await page.getByRole("heading", { name: "Start a new edit" }).waitFor();
  await page.getByLabel("Saved edit recovery").filter({ hasText: "Your saved edit couldn’t be opened" }).waitFor();
  assert.equal(await page.locator('[data-notification-id="restoreFailed"]').count(), 0, "The inline recovery surface replaces the duplicate toast");
  assert.equal(await page.getByRole("button", { name: "Restore issue" }).count(), 0, "The inline recovery surface replaces the duplicate retained issue");
  const start = page.getByRole("button", { name: "Start editing", exact: true });
  assert.equal(await start.isDisabled(), true);
  await page.getByLabel("Upload video files").setInputFiles(videoFile);
  await page.getByText("Clips are ready", { exact: true }).waitFor();
  assert.equal(await start.isDisabled(), true, "Staging media must not overwrite an unread checkpoint");
  await page.getByRole("button", { name: "Discard saved edit", exact: true }).click();
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(item => item.textContent?.trim().startsWith("Start editing"));
    return button && !button.disabled;
  });
  await page.getByText("Clips are ready", { exact: true }).waitFor();
  const retained = await inspectProjectStorage(page,
    ["current", "project:legacy-project", "project:kept-project"],
    ["asset:legacy", "asset:kept", "asset:shared"]);
  assert.deepEqual(retained, {
    checkpointIds: [null, null, "kept-project"],
    media: [false, true, true],
  }, "Discard must remove only the unreadable edit and its unshared media");
  await start.click();
  await desktop(page).waitFor();
  const projectId = new URL(page.url()).searchParams.get("project");
  assert.ok(projectId);
  assert.equal(await clips(page).count(), 1, "The staged upload must survive recovery discard");
  await saved(page, projectId);
  await context.close();
}

async function targetedRecoveryDiscard() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const kept = checkpoint("kept-project", [], ["asset:kept", "asset:shared"]);
  await seedProjectStorage(page, [
    ["current", kept],
    ["project:kept-project", kept],
    ["project:legacy-project", checkpoint("legacy-project", [oldChoice], ["asset:legacy", "asset:shared"])],
  ], ["asset:legacy", "asset:kept", "asset:shared"]);
  const url = new URL(editorUrl);
  url.search = "?project=legacy-project";
  await page.goto(url.href);
  await page.getByLabel("Saved edit recovery").waitFor();
  const start = page.getByRole("button", { name: "Start editing", exact: true });
  await page.getByLabel("Upload video files").setInputFiles([
    { name: "preview.mp4", mimeType: "video/mp4", buffer: videoBytes },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not video") },
  ]);
  await page.getByText("Clips are ready", { exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "isn't a supported video" }).waitFor();
  await page.getByRole("button", { name: "Discard saved edit", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Keep saved edit");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Discard saved edit");
  await page.getByRole("button", { name: "Discard saved edit", exact: true }).click();
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(item => item.textContent?.trim().startsWith("Start editing"));
    return button && !button.disabled;
  });
  await page.waitForTimeout(1000);
  assert.deepEqual(await inspectProjectStorage(page,
    ["current", "project:kept-project", "project:legacy-project"],
    ["asset:kept", "asset:shared", "asset:legacy"]), {
    checkpointIds: ["kept-project", "kept-project", null],
    media: [true, true, false],
  }, "A targeted discard must not replace the unrelated current project with a blank workspace");
  await start.click();
  await desktop(page).waitFor();
  const projectId = new URL(page.url()).searchParams.get("project");
  assert.ok(projectId);
  await saved(page, projectId);
  assert.deepEqual(await inspectProjectStorage(page,
    ["current", "project:kept-project", `project:${projectId}`], ["asset:kept"]), {
    checkpointIds: [projectId, "kept-project", projectId], media: [true],
  }, "Starting the replacement must preserve the unrelated named project and media");
  await context.close();
}

async function malformedRetainedCheckpoint() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const legacy = checkpoint("legacy-project", [oldChoice], ["asset:legacy"]);
  const malformed = checkpoint("malformed-project");
  delete malformed.assetIds;
  await seedProjectStorage(page, [
    ["current", legacy],
    ["project:legacy-project", legacy],
    ["project:malformed-project", malformed],
  ], ["asset:legacy", "asset:unknown"]);
  const home = new URL(editorUrl);
  home.search = "?home=1";
  await page.goto(home.href);
  await page.getByRole("button", { name: "Discard saved edit", exact: true }).click();
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await page.getByLabel("Saved edit recovery").waitFor({ state: "detached" });
  assert.deepEqual(await inspectProjectStorage(page,
    ["current", "project:legacy-project", "project:malformed-project"],
    ["asset:legacy", "asset:unknown"]), {
    checkpointIds: [null, null, "malformed-project"],
    media: [true, true],
  }, "Unreadable retained metadata must disable media cleanup instead of risking another project");
  await page.getByLabel("Upload video files").setInputFiles(videoFile);
  await page.getByText("Clips are ready", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Start editing", exact: true }).click();
  await desktop(page).waitFor();
  const projectId = new URL(page.url()).searchParams.get("project");
  assert.ok(projectId);
  await saved(page, projectId);
  assert.deepEqual(await inspectProjectStorage(page,
    ["current", "project:malformed-project", `project:${projectId}`],
    ["asset:legacy", "asset:unknown"]), {
    checkpointIds: [projectId, "malformed-project", projectId],
    media: [true, true],
  }, "Malformed retained metadata must not prevent the replacement edit from saving");
  await context.close();
}

async function mobileTargetedRecoveryImport() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const kept = checkpoint("kept-project", [], ["asset:kept"]);
  await seedProjectStorage(page, [
    ["current", kept],
    ["project:kept-project", kept],
    ["project:legacy-project", checkpoint("legacy-project", [oldChoice], [])],
  ], ["asset:kept"]);
  const url = new URL(editorUrl);
  url.search = "?project=legacy-project";
  await page.goto(url.href);
  await page.locator('[data-notification-id="restoreFailed"]').waitFor();
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Restore issue", exact: true }).count(), 0);
  await page.getByText("Storage options", { exact: true }).click();
  const storage = page.getByRole("region", { name: "Project storage", exact: true });
  await storage.getByRole("button", { name: "Discard saved edit", exact: true }).click();
  await storage.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor", exact: true }).waitFor();
  await page.waitForTimeout(1200);
  assert.deepEqual(await inspectProjectStorage(page,
    ["current", "project:kept-project", "project:legacy-project"], ["asset:kept"]), {
    checkpointIds: [null, "kept-project", null], media: [true],
  }, "Anonymous mobile replacement footage must not delete an unrelated current project's named checkpoint");
  await context.close();
}

async function directTemplateFilter() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/publishing", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: false, hasSession: false, maxBytes: 0 }) }));
  const url = new URL(editorUrl);
  url.search = "?home=1&filter=interactive";
  await page.goto(url.href);
  await page.getByRole("heading", { name: "Start a new edit" }).waitFor();
  await page.locator("#restyle-launch-splash").waitFor({ state: "detached" });
  const gallery = page.locator("[data-template-gallery]");
  await waitForCards(gallery, 5);
  assert.equal(await gallery.getByRole("tab", { name: "Interactive" }).getAttribute("aria-selected"), "true");
  assert.equal(await gallery.getByText("5 templates", { exact: true }).count(), 1);
  assert.equal(await gridTracks(gallery), 5);
  await context.close();
}

async function reducedMotionTemplates() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/publishing", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: false, hasSession: false, maxBytes: 0 }) }));
  const url = new URL(editorUrl);
  url.search = "?home=1";
  await page.goto(url.href);
  await page.getByRole("heading", { name: "Start a new edit" }).waitFor();
  await page.locator("#restyle-launch-splash").waitFor({ state: "detached" });
  const previews = page.locator("[data-template-preview]");
  assert.equal(await previews.count(), 6);
  assert.equal(await previews.evaluateAll(nodes => nodes.every(node => node.getAnimations({ subtree: true }).length === 0)), true,
    "Reduced motion should freeze every template hint");
  await context.close();
}

try {
  for (const width of [1024, 1280, 1440]) await run(width);
  await directTemplateFilter();
  await reducedMotionTemplates();
  await dropVariant();
  await stagedResize();
  await recoveryDiscard();
  await targetedRecoveryDiscard();
  await malformedRetainedCheckpoint();
  await mobileTargetedRecoveryImport();
  assert.deepEqual(errors, []);
  console.log(`Responsive create passed: 1024/1280/1440 landscape plus existing phone/portrait editor, upload, ratio, Google sign-in before export, stable routes, saved media, targeted recovery discard, multiple projects, templates and page-wide drop-ready strip. Screenshots: ${screenshots}`);
} finally { await browser.close(); }
