import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSync } from "esbuild";

// Fresh browser contexts only: these tests never open a user's project storage.
const bundle = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: [
      "export * from './editor/src/infrastructure/projectPersistence/index.ts';",
      "export * from './editor/src/infrastructure/projectPersistence/indexedDb.ts';",
      "export * from './editor/src/infrastructure/projectPersistence/discardMarker.ts';",
      "export { initial } from './editor/src/state/project/initial.ts';",
      "export { useCapture } from './editor/src/state/captureStore.ts';",
      "export { restore as restoreProject } from './editor/src/state/project/history.ts';",
    ].join("\n"),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "savingFixture",
  logLevel: "error",
}).outputFiles[0].text;
const video = await readFile(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
);
const server = createServer((request, response) => {
  if (request.url === "/media.mp4") {
    response.writeHead(200, { "Content-Type": "video/mp4" }).end(video);
  } else {
    response
      .writeHead(200, { "Content-Type": "text/html" })
      .end("<!doctype html><title>Isolated saving fixture</title>");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
console.log("Isolated saving test origin: " + origin);
const browser = await launchBrowser({
  headless: true,
});
const failures = [];
async function boot(page) {
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
}
async function seed(page) {
  await page.evaluate(async () => {
    const api = window.savingFixture;
    const persistence = api.createProjectPersistence();
    await persistence.restore();
    for (const id of ["project-A", "project-B"]) {
      const state = api.initial();
      const url = URL.createObjectURL(await (await fetch("/media.mp4")).blob());
      const clip = {
        id: 1,
        url,
        color: "#554466",
        srcDur: 4,
        in: 0,
        out: 4,
        speed: 1,
        zoom: 1,
        mirror: false,
        width: 720,
        height: 1280,
        fit: "contain",
      };
      state.scenes[0].clips = [clip];
      state.scenes[0].texts = [
        {
          id: 7,
          text: "Original " + id,
          color: 0,
          start: 0,
          end: 4,
          x: 50,
          y: 40,
        },
      ];
      persistence.schedule({
        ...state,
        localId: id,
        projectName: id,
        screen: "editor",
      });
      await persistence.flush();
    }
    await persistence.dispose();
  });
}
async function open(page, id) {
  await page.evaluate(async (id) => {
    const api = window.savingFixture;
    const persistence = api.createProjectPersistence(id);
    const saved = await persistence.restore();
    if (!saved) throw new Error("Fixture project was not restored");
    const base = { ...api.initial(), ...saved };
    api.useCapture.setState({
      ...base,
      ...api.restoreProject(base, saved.project),
    });
    window.persistence = persistence;
    window.capture = api.useCapture;
    window.unsubscribeSaving = api.useCapture.subscribe((state) =>
      persistence.schedule(state),
    );
  }, id);
}
async function summary(page, id) {
  return page.evaluate(async (id) => {
    const api = window.savingFixture;
    const database = await api.openProjectDatabase();
    try {
      const record = await api.readProjectCheckpoint(database, id);
      const current = await api.readProjectCheckpoint(database);
      const media = record
        ? await api.readProjectMedia(database, record.assetIds)
        : new Map();
      return {
        exists: !!record,
        name: record?.projectName,
        text: record?.project.scenes[0].texts[0]?.text,
        time: record?.resume.t,
        assets: record?.assetIds ?? [],
        blobs: media.size,
        current: current?.localId,
        past: record?.past.length,
      };
    } finally {
      database.close();
    }
  }, id);
}
async function edit(page, name) {
  await page.evaluate((name) => {
    const state = window.capture.getState();
    state.updateText(7, { text: name });
    state.patch({ projectName: name });
  }, name);
}
async function flush(page) {
  return page.evaluate(async () => {
    try {
      await window.persistence.flush();
      return true;
    } catch {
      return false;
    }
  });
}
async function run(name, test) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const a = await context.newPage(),
    b = await context.newPage();
  const errors = [];
  for (const page of [a, b])
    page.on("pageerror", (error) => errors.push(error.message));
  try {
    await boot(a);
    await seed(a);
    await boot(b);
    await test(a, b);
    assert.deepEqual(errors, []);
    console.log("PASS: " + name);
  } catch (error) {
    failures.push(name);
    console.error("FAIL: " + name, error);
  } finally {
    await context.close();
  }
}
async function recoveryUi(width, height, theme, deletedOriginal = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    serviceWorkers: "block",
  });
  const errors = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  const base = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
  const editor = new URL(base);
  editor.searchParams.set("project", "project-A");
  await context.route("**/api/**", (route) =>
    route.fulfill({ json: { available: false, authenticated: false } }),
  );
  await context.route("**/__saving-fixture__", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await context.route("**/media.mp4", (route) =>
    route.fulfill({ contentType: "video/mp4", body: video }),
  );
  try {
    const observer = await context.newPage();
    await observer.goto(new URL("/__saving-fixture__", base).href);
    await observer.addScriptTag({ content: bundle });
    await seed(observer);
    const a = await context.newPage(),
      b = await context.newPage();
    for (const page of [a, b]) {
      page.setDefaultTimeout(15000);
      await page.goto(editor.href);
      await page.evaluate(async () => {
        window.capture = (
          await import("/src/state/captureStore.ts")
        ).useCapture;
        window.autosave = await import("/src/app/projectAutosave.ts");
      });
      await page.waitForFunction(() => {
        const status = window.autosave.getProjectStorageStatus();
        return status.phase === "ready" && !status.storage.dirty;
      });
    }
    if (deletedOriginal)
      await a.evaluate(() => window.capture.getState().reset());
    else await edit(a, "Latest from A");
    await a.waitForFunction(
      () => !window.autosave.getProjectStorageStatus().storage.dirty,
    );
    const original = await summary(observer, "project-A");
    await edit(b, "My local version");
    await b.waitForFunction(
      () => window.autosave.getProjectStorageStatus().storage.conflict,
    );
    await b
      .getByRole("button", { name: "Review save issue", exact: true })
      .click();
    const storage = b.getByRole("region", {
      name: "Project storage",
      exact: true,
    });
    const copy = storage.getByRole("button", {
      name: "Save a copy",
      exact: true,
    });
    await copy.waitFor();
    assert.equal(await copy.isEnabled(), true);
    const bounds = await copy.boundingBox();
    assert(
      bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y + bounds.height <= height,
      "Recovery stays reachable at this viewport size",
    );
    if (process.env.PVO_SAVING_SCREENSHOTS) {
      await mkdir(process.env.PVO_SAVING_SCREENSHOTS, { recursive: true });
      await b.screenshot({
        path: join(
          process.env.PVO_SAVING_SCREENSHOTS,
          `saving-conflict-${width}-${theme}${deletedOriginal ? "-deleted-original" : ""}.png`,
        ),
      });
    }
    await copy.click();
    await b.waitForFunction(() => {
      const status = window.autosave.getProjectStorageStatus();
      return (
        window.capture.getState().localId !== "project-A" &&
        status.storage.phase === "saved" &&
        !status.storage.dirty
      );
    });
    const id = await b.evaluate(() => window.capture.getState().localId);
    assert(id);
    assert.equal(new URL(b.url()).searchParams.get("project"), id);
    assert.deepEqual(await summary(observer, "project-A"), original);
    const savedCopy = await summary(observer, id);
    assert.equal(savedCopy.name, "Copy of My local version");
    assert.equal(savedCopy.text, "My local version");
    assert(savedCopy.past > 0, "The recovery copy preserves Undo history");
    assert.equal(savedCopy.blobs, savedCopy.assets.length);
    assert.equal(
      await b.evaluate(
        () => window.autosave.getProjectStorageStatus().storage.conflict,
      ),
      false,
    );
    await b.reload();
    await b.waitForFunction(() => document.readyState === "complete");
    await b.waitForFunction(async () => {
      const { getProjectStorageStatus } =
        await import("/src/app/projectAutosave.ts");
      return getProjectStorageStatus().phase === "ready";
    });
    assert.equal(
      await b.evaluate(
        async () =>
          (await import("/src/state/captureStore.ts")).useCapture.getState()
            .texts[0].text,
      ),
      "My local version",
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS: actual recovery button, copy and reload at ${width}px ${theme}${deletedOriginal ? " after original deletion" : ""}`,
    );
  } finally {
    await context.close();
  }
}
try {
  await run(
    "reset A preserves B, its current pointer and media",
    async (a, b) => {
      await open(a, "project-A");
      await open(b, "project-B");
      const before = await summary(b, "project-B");
      await a.evaluate(() => window.capture.getState().reset());
      assert.equal(await flush(a), true);
      assert.equal((await summary(a, "project-A")).exists, false);
      assert.deepEqual(await summary(b, "project-B"), before);
      assert.equal(
        await b.evaluate(() => window.savingFixture.getProjectDiscard()),
        null,
      );
    },
  );
  await run("reset plus immediate reload remains scoped to A", async (a, b) => {
    await open(a, "project-A");
    await open(b, "project-B");
    await a.evaluate(() => window.capture.getState().reset());
    await boot(a);
    const restored = await a.evaluate(async () => {
      const persistence =
        window.savingFixture.createProjectPersistence("project-A");
      const result = await persistence.restore();
      await persistence.dispose();
      return result;
    });
    assert.equal(restored, null);
    assert.equal((await summary(b, "project-B")).exists, true);
    assert.equal((await summary(a, "project-A")).exists, false);
  });
  await run(
    "reset during this tab's own write still discards only A",
    async (a, b) => {
      await open(a, "project-A");
      await open(b, "project-B");
      const other = await summary(b, "project-B");
      await a.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        let reset = true;
        IDBObjectStore.prototype.put = function (...args) {
          if (reset && this.name === "checkpoints") {
            reset = false;
            window.capture.getState().reset();
          }
          return put.apply(this, args);
        };
      });
      await edit(a, "Save finishing during reset");
      assert.equal(await flush(a), true);
      assert.equal((await summary(a, "project-A")).exists, false);
      assert.deepEqual(await summary(b, "project-B"), other);
    },
  );
  await run(
    "a stale paused scrub cannot overwrite newer text or Undo",
    async (a, b) => {
      await open(a, "project-A");
      await open(b, "project-A");
      await edit(a, "New content from A");
      assert.equal(await flush(a), true);
      const before = await summary(a, "project-A");
      await b.evaluate(() => window.capture.getState().patch({ t: 1 }));
      assert.equal(await flush(b), false);
      assert.deepEqual(await summary(a, "project-A"), before);
      assert.equal(
        await b.evaluate(() => window.persistence.getStatus().conflict),
        true,
      );
      assert.equal(await b.evaluate(() => window.capture.getState().t), 1);
    },
  );
  await run(
    "stale reset cannot delete the newer version of the same project",
    async (a, b) => {
      await open(a, "project-A");
      await open(b, "project-A");
      await edit(b, "New version from B");
      assert.equal(await flush(b), true);
      const before = await summary(b, "project-A");
      await a.evaluate(() => window.capture.getState().reset());
      assert.equal(await flush(a), false);
      assert.deepEqual(await summary(b, "project-A"), before);
    },
  );
  await run("simultaneous writes have exactly one winner", async (a, b) => {
    await open(a, "project-A");
    await open(b, "project-A");
    await edit(a, "Writer A");
    await edit(b, "Writer B");
    const results = await Promise.all([flush(a), flush(b)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(
      (await summary(a, "project-A")).text,
      results[0] ? "Writer A" : "Writer B",
    );
  });
  await run(
    "different projects save independently without taking over current",
    async (a, b) => {
      await open(a, "project-A");
      await open(b, "project-B");
      await edit(a, "Project A change");
      await edit(b, "Project B change");
      assert.deepEqual(await Promise.all([flush(a), flush(b)]), [true, true]);
      const savedA = await summary(a, "project-A"),
        savedB = await summary(b, "project-B");
      assert.equal(savedA.text, "Project A change");
      assert.equal(savedB.text, "Project B change");
      assert.equal(savedA.current, "project-B");
      assert.equal(savedA.blobs, savedA.assets.length);
      assert.equal(savedB.blobs, savedB.assets.length);
    },
  );
  await run(
    "a conflicting tab can save a separate copy with its history",
    async (a, b) => {
      await open(a, "project-A");
      await open(b, "project-A");
      await edit(a, "New original");
      assert.equal(await flush(a), true);
      const original = await summary(a, "project-A");
      await edit(b, "Local unsaved work");
      assert.equal(await flush(b), false);
      await b.evaluate(() =>
        window.capture
          .getState()
          .patch({ localId: "project-copy", assistantTaskLinks: null }),
      );
      assert.equal(await flush(b), true);
      assert.deepEqual(await summary(a, "project-A"), original);
      const copy = await summary(b, "project-copy");
      assert.equal(copy.text, "Local unsaved work");
      assert(copy.past > 0);
      assert.equal(copy.blobs, copy.assets.length);
    },
  );
  await run(
    "a copy carries its video after another tab deletes the original",
    async (a, b) => {
      await open(a, "project-A");
      await open(b, "project-A");
      const other = await summary(a, "project-B");
      await a.evaluate(() => window.capture.getState().reset());
      assert.equal(await flush(a), true);
      assert.equal((await summary(a, "project-A")).exists, false);
      await edit(b, "Kept after deletion");
      assert.equal(await flush(b), false);
      await b.evaluate(() =>
        window.capture.getState().patch({ localId: "kept-copy" }),
      );
      assert.equal(await flush(b), true);
      const copy = await summary(b, "kept-copy");
      assert.equal(copy.text, "Kept after deletion");
      assert(copy.assets.length > 0);
      assert.equal(copy.blobs, copy.assets.length);
      assert.deepEqual(await summary(a, "project-B"), other);
    },
  );
  await run(
    "a rejected stale save cannot insert or collect media",
    async (a, b) => {
      await open(a, "project-A");
      await open(b, "project-A");
      await edit(a, "Latest media owner");
      assert.equal(await flush(a), true);
      const original = await summary(a, "project-A");
      const other = await summary(a, "project-B");
      await b.evaluate(async () => {
        const state = window.capture.getState();
        const url = URL.createObjectURL(
          await (await fetch("/media.mp4")).blob(),
        );
        state.edit({ clips: state.clips.map((clip) => ({ ...clip, url })) });
      });
      assert.equal(await flush(b), false);
      assert.deepEqual(await summary(a, "project-A"), original);
      assert.deepEqual(await summary(a, "project-B"), other);
      const mediaCount = await a.evaluate(async () => {
        const database = await window.savingFixture.openProjectDatabase();
        try {
          return await new Promise((resolve, reject) => {
            const request = database
              .transaction("media")
              .objectStore("media")
              .count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } finally {
          database.close();
        }
      });
      assert.equal(
        mediaCount,
        new Set([...original.assets, ...other.assets]).size,
      );
    },
  );
  await run(
    "restoring without edits does not manufacture a competing save",
    async (a, b) => {
      await open(a, "project-A");
      await open(b, "project-A");
      await a.evaluate(() =>
        window.persistence.schedule(window.capture.getState()),
      );
      assert.equal(await flush(a), true);
      await edit(b, "First real edit");
      assert.equal(await flush(b), true);
    },
  );
  assert.deepEqual(
    failures,
    [],
    "Saving regression failures: " + failures.join(", "),
  );
  console.log("Two-tab saving checks passed using isolated actual IndexedDB.");
  if (!process.env.PVO_SAVING_DATA_ONLY) {
    for (const [width, height, theme] of [
      [393, 852, "light"],
      [320, 568, "dark"],
      [1280, 800, "dark"],
    ])
      await recoveryUi(width, height, theme);
    await recoveryUi(393, 852, "light", true);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
