import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";
import { installAssistantAvailabilityFixture } from "../editor/assistant-fixture.mjs";
import { openIndependentViewer } from "../cloud-agent-first-release/viewer.mjs";

/** Real editor/compiler/export and two independent players. Account identity and publication storage are controlled. */
export async function checkProductBrowser({
  origin,
  directory,
  identity,
  api,
  call,
  record,
  publicBridge = false,
  clientClockOffsetMs = 0,
}) {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  if (clientClockOffsetMs)
    await context.addInitScript((offset) => {
      const current = Date.now.bind(Date);
      Date.now = () => current() + offset;
    }, clientClockOffsetMs);
  const sourceUrl = process.env.EDITOR_URL || "http://127.0.0.1:5319/";
  const media = await readFile(
    new URL("../../../share/assets/preview.mp4", import.meta.url),
  );
  const errors = [];
  let viewer, page;
  try {
    await context.route(origin + "/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: new URL(url.pathname + url.search, sourceUrl).href,
      });
      await route.fulfill({ response });
    });
    await installAssistantAvailabilityFixture(context);
    await context.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          available: true,
          clerkAvailable: false,
          clerkPublishableKey: null,
          canLinkEmail: false,
          emailLinked: false,
          user: { id: identity.ownerId, name: "Node acceptance" },
        },
      }),
    );
    await context.route("**/api/publishing", (route) =>
      route.fulfill({
        json: { available: false, hasSession: true, maxBytes: 0 },
      }),
    );
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
    await context.route(
      /\/api\/(services|assistant\/(projects|tasks))(\/.*)?$/,
      async (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (path.endsWith("/actions")) return route.continue();
        const reply = await api(
          path,
          request.method(),
          request.postData() ? request.postDataJSON() : undefined,
        );
        await route.fulfill({ status: reply.status, json: reply.body });
      },
    );
    await context.route("**/node-acceptance.mp4", (route) =>
      route.fulfill({ contentType: "video/mp4", body: media }),
    );
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/");
    console.log("Node browser: editor loaded");
    await page
      .getByRole("button", { name: "Blank project", exact: true })
      .click();
    await page.waitForURL((url) => url.searchParams.has("project"));
    await page.waitForFunction(
      async () =>
        (await import("/src/app/projectAutosave.ts")).getProjectStorageStatus()
          .phase === "ready",
    );
    await page.locator("#root[inert]").waitFor({ state: "hidden" });
    console.log("Node browser: project ready");
    await page.evaluate(async () =>
      (
        await import("/src/state/auth/authGateStore.ts")
      ).refreshAccountSession(),
    );
    const component = await page.evaluate(async (identity) => {
      const { mkClip } = await import("/src/store.ts");
      const { useCapture } = await import("/src/state/captureStore.ts");
      const storage = await import("/src/app/projectAutosave.ts");
      const { navigateProject } = await import("/src/app/navigation.ts");
      window.resultProbe = { useCapture, storage };
      const blob = await (await fetch("/node-acceptance.mp4")).blob();
      const clip = mkClip(3, URL.createObjectURL(blob), 0),
        state = useCapture.getState();
      // The diagnostic service was created for this same local-project identity.
      state.patch({
        localId: "node-product",
        projectName: "Node Container acceptance",
        ratio: "9:16",
        clips: [clip],
        scenes: state.scenes.map((scene) =>
          scene.id === state.currentSceneId
            ? { ...scene, clips: [clip] }
            : scene,
        ),
      });
      navigateProject("node-product");
      const id = useCapture.getState().addComponent("form");
      useCapture.getState().updateComponent(id, {
        fields: {
          formFields: [{ name: "Guest", type: "text" }],
          heading: "Dinner",
          submitLabel: "Join",
          formSubmitMode: "local",
          outcome: { kind: "continue" },
        },
      });
      await storage.saveProjectBeforeUpdate();
      return { id, sceneId: useCapture.getState().currentSceneId };
    }, identity);
    await page.waitForFunction(
      async (identity) =>
        (
          await import("/src/state/assistant/sessionScope.ts")
        ).useAssistantScope.getState().ownerId === identity.ownerId,
      identity,
    );
    await page
      .getByRole("button", { name: "Project settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "More settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Containers", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Connect to component", exact: true })
      .click();
    const region = page.getByRole("region", {
      name: "Connect this Container",
      exact: true,
    });
    await region
      .getByRole("combobox", { name: "Component", exact: true })
      .selectOption(JSON.stringify([component.sceneId, component.id]));
    await region
      .getByRole("combobox", { name: "Published operation", exact: true })
      .selectOption("join");
    await region
      .getByRole("button", { name: "Connect component", exact: true })
      .click();
    await page.waitForFunction(() =>
      Boolean(
        window.resultProbe.useCapture.getState().components[0]
          .serviceConnection,
      ),
    );
    console.log("Node browser: Component connected");
    await page.evaluate(async () => {
      window.resultProbe.useCapture.getState().patch({ sheet: null, t: 0 });
      (await import("/src/features/preview/tryMode.ts")).startTry();
      window.resultProbe.useCapture.getState().patch({ playing: false });
    });
    const tried = page.waitForResponse(
      (r) => r.url().endsWith("/try") && r.request().method() === "POST",
      { timeout: 315000 },
    );
    const tryFrame = page
      .locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]')
      .first()
      .contentFrame();
    await tryFrame.getByRole("textbox").fill("Alice");
    await tryFrame.getByRole("button", { name: "Join", exact: true }).click();
    const tryResponse = await tried;
    assert.equal(tryResponse.status(), 200);
    assert.equal((await tryResponse.json()).result, "already_joined");
    console.log("Node browser: Try passed");
    await page.evaluate(async () => {
      (await import("/src/features/preview/tryMode.ts")).stopTry();
      (await import("/src/state/export/exportCommands.ts")).requestExport();
    });
    await page
      .getByRole("dialog", { name: "Export", exact: true })
      .getByRole("button", { name: /Export and share/ })
      .click();
    const share = page.locator("[data-share-panel]");
    await share.waitFor();
    const downloaded = page.waitForEvent("download");
    await share.locator("[data-download-again]").click();
    const download = await downloaded;
    assert.equal(await download.failure(), null);
    const bytes = await readFile(await download.path());
    const project = await readPvoProject(new Blob([bytes]));
    console.log("Node browser: exported PVO downloaded");
    assert(project.validation.valid);
    const connection =
      project.manifest.components[0].restyle_capture.service_connection;
    assert.equal(connection.serviceId, identity.serviceId);
    for (const field of ["ownerId", "readiness", "reportDigest", "receipt"])
      assert(!JSON.stringify(connection).includes(field));
    if (directory)
      await writeFile(`${directory}/node-container.pvo`, bytes, {
        mode: 0o600,
      });
    await page.close();
    viewer = await openIndependentViewer(browser, bytes, {
      id: "acceptance_node_container",
      bytes,
    });
    if (publicBridge)
      await viewer.context.route(origin + "/api/services/**", async (route) => {
        const req = route.request();
        const reply = await call(
          new URL(req.url()).pathname,
          req.method(),
          req.postData() ? req.postDataJSON() : undefined,
          false,
        );
        await route.fulfill({
          status: reply.status,
          json: reply.data,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          },
        });
      });
    const replies = [];
    for (const published of [false, true]) {
      const frame = published ? await viewer.openPublished() : viewer.frame;
      await frame.getByRole("textbox").fill(published ? "Bob" : "Viewer");
      const pending = viewer.page.waitForResponse(
        (r) => r.url().endsWith("/actions") && r.request().method() === "POST",
        { timeout: 315000 },
      );
      void pending.catch(() => {});
      await frame.getByRole("button", { name: "Join", exact: true }).click();
      const response = await pending;
      assert.equal(response.status(), 200);
      const headers = await response.request().allHeaders();
      assert.equal(headers.cookie, undefined);
      assert.equal(headers.authorization, undefined);
      const reply = await response.json();
      assert.equal(reply.result, published ? "already_joined" : "full");
      replies.push(reply);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(viewer.errors, []);
    await record("real_editor_export_and_two_players", {
      connection,
      replies,
      bytes: bytes.length,
      creatorClosed: page.isClosed(),
      publicationStorage: "controlled fixture",
    });
  } catch (error) {
    const current = viewer?.page ?? page;
    if (current && !current.isClosed()) {
      await current
        .screenshot({
          path: `${directory ?? "/tmp"}/node-product-browser-failure.png`,
        })
        .catch(() => {});
      console.error(
        "Node browser failure:",
        error.message,
        errors,
        await current
          .locator("body")
          .innerText()
          .catch(() => "unavailable"),
      );
    }
    throw error;
  } finally {
    await context.unrouteAll({ behavior: "ignoreErrors" });
    await viewer?.close();
    await context.close();
    await browser.close();
  }
}
