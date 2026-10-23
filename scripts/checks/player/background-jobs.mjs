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
import { fixture as accountFixture } from "../../../tests/account-connections/helpers.mjs";
import { checkedAcceptance } from "../../../tests/service-jobs/acceptance.fixture.mjs";
import {
  emailProvider,
  emailConnect,
} from "../../../tests/service-jobs/email.fixture.mjs";
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
for (const name of ["receipt.html", "receipt.js", "receipt.css"])
  assets.set("/" + name, {
    body: await readFile(new URL("../../../public/" + name, import.meta.url)),
    type: name.endsWith("html")
      ? "text/html"
      : name.endsWith("css")
        ? "text/css"
        : "text/javascript",
  });
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
    if (!request.url.startsWith("/api/")) {
      const asset = assets.get(new URL(request.url, "http://local").pathname);
      response.writeHead(asset ? 200 : 404, {
        "Content-Type": asset?.type ?? "text/plain",
      });
      response.end(asset?.body ?? "Missing");
      return;
    }
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
    if (!(request.url.endsWith("/job-receipt") && result.status === 404))
      expectStatus(
        result,
        request.method === "OPTIONS"
          ? 204
          : request.url.endsWith("/jobs")
            ? 202
            : 200,
      );
    if (body && loseReply && request.url.endsWith("/jobs")) {
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
const profile = await mkdtemp(join(tmpdir(), "restyle-player-background-"));
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
  const email = emailProvider(),
    checked = await checkedAcceptance();
  fixture = await accountFixture({
    services: true,
    connectionFetch: email.fetch,
  });
  expectStatus(await fixture.connection("connect", emailConnect()), 200);
  const service = await hosted(fixture, { checked });
  expectStatus(
    await fixture.request(
      `/api/services/${service.identity.serviceId}/account-access`,
      { body: { kind: "approve", releaseId: service.identity.resourceId } },
    ),
    200,
  );
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
      { identity: row.identity, ...checked },
      observed,
      "accept",
      NOW,
    ),
    connection: {
      ...attachment(service.identity.resourceId).connection,
      operation: "accept",
    },
  });
  const request = {
    url: `${serviceOrigin}/api/services/${connection.serviceId}/actions`,
    method: "POST",
    body: JSON.stringify({ operation: "accept", input: connection.input }),
    onSuccess: { kind: "continue" },
    onError: null,
  };
  const source = {
    structure:
      '<form><heading>Accept invitation</heading><field name="guest" kind="name" label="Name"/><submit>Accept</submit></form>',
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
        title: "Accept invitation",
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
        submit_label: "Accept",
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
  await page
    .locator("#video")
    .evaluate((video) => video.addEventListener("play", () => video.pause()));
  await iframe(page).getByRole("textbox").fill("Viewer");
  await iframe(page)
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check saved submission", exact: true })
    .waitFor();
  await page.locator('#playerFrame[data-state="error"]').waitFor();
  const [pending] = await saved(page);
  assert.ok(
    pending.response === null || pending.response.job.status === "received",
  );
  assert.equal(email.sends, 0);
  const submissionCount = wires.filter((value) => value.action).length;
  assert.ok(submissionCount >= 1);
  assert.equal(
    new Set(
      wires
        .filter((value) => value.action)
        .map((value) => JSON.stringify(value)),
    ).size,
    1,
  );
  await context.close();
  context = null;
  // Every viewing browser is closed. The server worker completes the accepted job after a full restart.
  await fixture.restart();
  loseReply = false;
  expectStatus(
    await fixture.control({
      action: "host-diagnostic",
      identity: service.identity,
      kind: "sweep",
    }),
    200,
  );
  assert.equal(email.sends, 1);
  await launch();
  page = await open();
  await page
    .getByText("Email accepted by sender; delivery pending", { exact: true })
    .waitFor();
  const [accepted] = await saved(page);
  assert.equal(accepted.response.job.status, "pending");
  const link = await page
    .getByRole("link", { name: "Save private receipt link" })
    .getAttribute("href");
  assert.ok(link.includes("/receipt.html#"));
  assert.equal(wires.filter((value) => value.action).length, submissionCount);
  await page.screenshot({ path: "/tmp/restyle-3-player-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/restyle-3-player-phone.png" });
  await context.close();
  context = null;
  email.event = "delivered";
  await fixture.control({ action: "time", now: NOW + 60001 });
  await fixture.control({
    action: "host-diagnostic",
    identity: service.identity,
    kind: "sweep",
  });
  await fixture.restart();
  // A new profile has no local submission; only the private link authorizes this one result.
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    const remote = await browser.newPage();
    remote.on("pageerror", (error) => errors.push(error.message));
    await remote.goto(link);
    await remote
      .getByText("Email delivered to recipient’s mail server", { exact: true })
      .waitFor();
    await remote.getByText("accepted", { exact: true }).waitFor();
    await remote.screenshot({ path: "/tmp/restyle-3-receipt-desktop.png" });
    await remote.setViewportSize({ width: 390, height: 844 });
    await remote.screenshot({ path: "/tmp/restyle-3-receipt-phone.png" });
    assert.equal(
      await remote.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const bad = new URL(link),
      value = JSON.parse(decodeURIComponent(bad.hash.slice(1)));
    value.receiptKey = "a".repeat(64);
    bad.hash = encodeURIComponent(JSON.stringify(value));
    await remote.goto(bad.href);
    await remote
      .getByText("This receipt is unavailable or has expired.", {
        exact: false,
      })
      .waitFor();
  } finally {
    await browser.close();
  }
  await launch();
  page = await open();
  await page
    .getByText("Email delivered to recipient’s mail server", { exact: true })
    .waitFor();
  assert.equal(wires.filter((value) => value.action).length, submissionCount);
  assert.equal(email.sends, 1);
  assert.deepEqual(serverFailures, []);
  assert.deepEqual(errors, []);
  console.log(
    "Background player acceptance passed: compiled PVO/export, saved IndexedDB intent, lost acceptance, closed viewers, full worker restart, status refresh, private cross-device receipt, wrong-key denial, desktop/phone and one email effect.",
  );
} finally {
  await context?.close();
  await fixture?.close();
  await close(player);
  await close(api);
  await rm(profile, { recursive: true, force: true });
}
