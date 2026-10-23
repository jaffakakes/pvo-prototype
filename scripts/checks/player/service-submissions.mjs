import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { playerSourceAssets } from "../helpers/player-assets.mjs";
import {
  taskFixture,
  hosted,
  control,
  inspect,
  expectStatus,
} from "../../../tests/service-actions/helpers.mjs";
import { NOW } from "../../../tests/assistant-task-server/helpers.mjs";
import { checkedFixture } from "../../../tests/service-hosting/fixtures.mjs";
import { attachment } from "../../../tests/service-attachments/fixtures.mjs";
import {
  prepareServiceAttachmentReceipt,
  projectPublicServiceConnection,
} from "../../../packages/pvo-assistant/attachments/index.js";
import {
  packPvoProject,
  PVO_SPEC_VERSION,
} from "../../../packages/pvo-sdk/index.js";

// Local-only acceptance: actual player/compiler/HTTP/CORS/SQLite/IndexedDB, with a checked fixed service.
const assets = await playerSourceAssets();
const player = createServer((request, response) => {
  const asset = assets.get(new URL(request.url, "http://local").pathname);
  response.writeHead(asset ? 200 : 404, {
    "Content-Type": asset?.type ?? "text/plain",
  });
  response.end(asset?.body ?? "Not found");
});
let fixture,
  context,
  loseReply = true;
const wires = [],
  errors = [],
  serverFailures = [];
const api = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : undefined;
    if (body) {
      assert.equal(
        request.headers.cookie,
        undefined,
        "public transport must omit a cookie even when one exists",
      );
      wires.push(body);
    }
    const result = await fixture.request(request.url, {
      method: request.method,
      session: null,
      ...(body ? { body } : {}),
      headers: Object.fromEntries(
        Object.entries(request.headers)
          .filter(([key]) =>
            [
              "origin",
              "content-type",
              "access-control-request-method",
              "access-control-request-headers",
            ].includes(key),
          )
          .map(([key, value]) => [
            key === "origin"
              ? "Origin"
              : key === "content-type"
                ? "Content-Type"
                : key,
            value,
          ]),
      ),
    });
    expectStatus(result, request.method === "OPTIONS" ? 204 : 200);
    if (body && loseReply) {
      response.destroy();
      return;
    }
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(
      result.body === null ? undefined : JSON.stringify(result.body),
    );
  } catch (error) {
    serverFailures.push(error.message);
    response.writeHead(500);
    response.end("Fixture failed");
  }
});
const profile = await mkdtemp(join(tmpdir(), "restyle-player-submissions-"));
let packageBuffer;
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
try {
  await listen(player);
  await listen(api);
  const playerOrigin = `http://127.0.0.1:${player.address().port}`;
  const serviceOrigin = `http://127.0.0.1:${api.address().port}`;
  fixture = await taskFixture({ services: true });
  const service = await hosted(fixture);
  expectStatus(await control(fixture, service, "activate"), 200);
  const row = (await fixture.control({ action: "provider-rows" })).body[0];
  const observed = (
    await fixture.control({
      action: "provider-status",
      identity: service.identity,
    })
  ).body.observation;
  const connection = projectPublicServiceConnection({
    origin: serviceOrigin,
    receipt: prepareServiceAttachmentReceipt(
      { identity: row.identity, ...(await checkedFixture()) },
      observed,
      "join",
      NOW,
    ),
    connection: attachment(service.identity.resourceId).connection,
  });
  const request = {
    url: `${serviceOrigin}/api/services/${connection.serviceId}/actions`,
    method: "POST",
    body: JSON.stringify({ operation: "join", input: connection.input }),
    onSuccess: { kind: "continue" },
    onError: null,
  };
  const source = {
    structure:
      '<form><heading>Join dinner</heading><field name="guest" kind="name" label="Name"/><submit>Join</submit></form>',
    style: " ",
    logic: `on submit { request(${JSON.stringify(request)}); }`,
  };
  const manifest = {
    spec_version: PVO_SPEC_VERSION,
    initial_scene: "main",
    canvas: { ratio: "9:16", width: 9, height: 16 },
    restyle_capture: { version: 1 },
    allowed_domains: [new URL(serviceOrigin).host],
    media: [
      {
        id: "main",
        asset_id: "video",
        name: "media/main.mp4",
        type: "video/mp4",
      },
    ],
    scenes: [{ id: "main", asset_id: "video", start: 0, end: 2 }],
    playback: {
      initial_timeline: "main",
      timelines: [
        {
          id: "main",
          kind: "main",
          clips: [
            { id: "clip", scene: "main", asset_id: "video", start: 0, end: 2 },
          ],
        },
      ],
    },
    components: [
      {
        id: "join",
        kind: "form",
        title: "Join dinner",
        presentation: {
          scene: "main",
          start: 0,
          end: 2,
          x: 0.1,
          y: 0.2,
          width: 0.8,
          height: 0.5,
        },
        fields: [{ name: "guest", type: "text" }],
        submit_label: "Join",
        on_submit: { type: "custom", name: "restyle_continue" },
        response_policy: { dispatch: "interaction", unanswered: "pause" },
        restyle_capture: {
          version: 1,
          at: 0,
          dur: null,
          x: 50,
          y: 45,
          service_connection: connection,
          code: {
            language: {
              version: 1,
              structure: "structure.pvo",
              style: "style.pvo",
              logic: "logic.pvo",
            },
          },
          outcomes: [{ kind: "request", ...request }],
        },
      },
    ],
  };
  const blob = await packPvoProject({
    manifest,
    assets: [
      {
        id: "video",
        name: "media/main.mp4",
        blob: new Blob(
          [
            await readFile(
              new URL("../../../assets/pvo-demo.mp4", import.meta.url),
            ),
          ],
          { type: "video/mp4" },
        ),
      },
      ...Object.entries(source).map(([part, value]) => ({
        id: `${part}.pvo`,
        name: `${part}.pvo`,
        blob: new Blob([value], { type: "text/plain" }),
      })),
    ],
  });
  packageBuffer = Buffer.from(await blob.arrayBuffer());
  async function launch() {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      executablePath:
        process.env.CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      viewport: { width: 900, height: 900 },
    });
    await context.addCookies([
      {
        name: "creator-session-probe",
        value: "must-not-send",
        url: serviceOrigin,
      },
    ]);
  }
  async function open() {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(playerOrigin + "/player/");
    await page.locator("#pvoInput").setInputFiles({
      name: "connected.pvo",
      mimeType: "application/vnd.pvo",
      buffer: packageBuffer,
    });
    await page
      .locator('.component-position iframe[sandbox="allow-same-origin"]')
      .waitFor();
    await page.locator("#video").evaluate((video) => video.pause());
    return page;
  }
  const iframe = (page) =>
    page
      .locator('.component-position iframe[sandbox="allow-same-origin"]')
      .contentFrame();
  async function saved(page) {
    return page.evaluate(async () => {
      const opened = indexedDB.open("restyle-service-submissions");
      return new Promise((resolve, reject) => {
        opened.onerror = () => reject(opened.error);
        opened.onsuccess = () => {
          const db = opened.result;
          const tx = db.transaction("submissions");
          const read = tx.objectStore("submissions").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(read.result);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    });
  }
  await launch();
  let page = await open();
  await iframe(page).getByRole("textbox").fill("{state.private.name}");
  await iframe(page).getByRole("button", { name: "Join", exact: true }).click();
  await page
    .getByRole("button", { name: "Check saved submission", exact: true })
    .waitFor();
  await page.locator('#playerFrame[data-state="error"]').waitFor();
  const [pending] = await saved(page);
  assert.equal(pending.response, null);
  assert.ok(wires.length >= 1);
  assert.ok(
    wires.every((value) => JSON.stringify(value) === JSON.stringify(wires[0])),
  );
  const firstAttempts = wires.length;
  await page.screenshot({ path: "/tmp/restyle-player-recovery.png" });
  await context.close();
  context = null;
  await fixture.restart();
  loseReply = false;
  await launch();
  page = await open();
  assert.deepEqual(await saved(page), [pending]);
  assert.equal(await iframe(page).getByRole("textbox").inputValue(), "");
  await page
    .getByRole("button", { name: "Check saved submission", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show saved result", exact: true })
    .waitFor();
  const [completed] = await saved(page);
  assert.equal(completed.response.result, "accepted");
  assert.deepEqual(wires[firstAttempts], wires[0]);
  await page.close();
  page = await open();
  await page
    .getByRole("button", { name: "Show saved result", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#video").paused === false,
  );
  assert.equal(
    wires.length,
    firstAttempts + 1,
    "recover completed result without another request",
  );
  await page.close();
  page = await open();
  await iframe(page).getByRole("textbox").fill("Bob");
  await iframe(page).getByRole("button", { name: "Join", exact: true }).click();
  await page
    .getByRole("button", { name: "Show saved result", exact: true })
    .waitFor();
  // The old completed recovery label may already exist; wait for the new saved action to settle.
  for (let attempt = 0; attempt < 50; attempt++) {
    const [value] = await saved(page);
    if (value.action.actionId !== completed.action.actionId && value.response)
      break;
    await page.waitForTimeout(20);
  }
  const [next] = await saved(page);
  assert.equal(next.response.result, "full");
  assert.notEqual(next.action.actionId, completed.action.actionId);
  assert.equal(wires.length, firstAttempts + 2);
  const state = await inspect(fixture, service);
  assert.deepEqual(
    state.data.map((value) => JSON.parse(value.body).guests),
    [["{state.private.name}"]],
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(serverFailures, []);
  console.log(
    "Player service acceptance passed: real compiled form + cross-origin HTTP/preflight, cookie omission, lost successful reply, full browser/server restart, empty-form recovery, completed-result replay, distinct next action and one live guest.",
  );
} catch (error) {
  const page = context?.pages().at(-1);
  console.error("Player acceptance state", {
    wires: wires.length,
    serverFailures,
    errors,
    text: await page
      ?.locator("body")
      .innerText()
      .catch(() => "unavailable"),
  });
  await page
    ?.screenshot({ path: "/tmp/restyle-player-recovery-error.png" })
    .catch(() => {});
  throw error;
} finally {
  await context?.close();
  await fixture?.close();
  await close(player);
  await close(api);
  await rm(profile, { recursive: true, force: true });
}
