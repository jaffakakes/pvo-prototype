import assert from "node:assert/strict";
import { chromium, webkit } from "playwright-core";

const editorUrl =
  process.env.EDITOR_URL ||
  process.env.RESTYLE_EDITOR_URL ||
  "http://127.0.0.1:5173/";
const browser =
  process.env.BROWSER === "webkit"
    ? await webkit.launch({ headless: true })
    : await chromium.launch({
        executablePath:
          process.env.CHROME_PATH ||
          (process.platform === "darwin"
            ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            : "C:/Program Files/Google/Chrome/Application/chrome.exe"),
        headless: true,
        args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
      });
const errors = [];
const lightSelector = '[data-screen-flash="true"]';

async function cameraPage(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  await context.addInitScript(
    ({
      rearTorch = false,
      actualFacing = null,
      failStart = false,
      failTorchOff = null,
    }) => {
      // Only the hardware boundary is synthetic: preview and recording use real
      // browser media tracks, frames, MediaRecorder events and encoded blobs.
      const fixture = (window.cameraFlashFixture = {
        requests: [],
        constraints: [],
        recorders: [],
        failures: [],
        started: 0,
        stopped: 0,
        active: 0,
      });
      // WebKit can return a fresh MediaDevices wrapper on every access.
      const devices = navigator.mediaDevices;
      Object.defineProperty(navigator, "mediaDevices", { value: devices });
      devices.getUserMedia = async (constraints) => {
        try {
          const requested = constraints.video?.facingMode ?? "user";
          const facing =
            actualFacing ??
            (typeof requested === "string" ? requested : requested.ideal);
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 240;
          const drawing = canvas.getContext("2d");
          let frame = 0;
          const draw = () => {
            drawing.fillStyle = frame++ % 2 ? "#16384b" : "#254a58";
            drawing.fillRect(0, 0, canvas.width, canvas.height);
          };
          draw();
          const timer = setInterval(draw, 33);
          const stream = canvas.captureStream(30);
          const track = stream.getVideoTracks()[0];
          const nativeSettings = track.getSettings.bind(track);
          const nativeStop = track.stop.bind(track);
          const request = { track, facing, torch: false };
          fixture.requests.push(request);
          Object.defineProperties(track, {
            getSettings: {
              value: () => ({
                ...nativeSettings(),
                facingMode: facing,
                torch: request.torch,
              }),
            },
            getCapabilities: {
              value: () => ({
                facingMode: [facing],
                ...(rearTorch && facing === "environment"
                  ? { torch: true }
                  : {}),
              }),
            },
            applyConstraints: {
              value: async (next) => {
                const torch = next.advanced?.find(
                  (value) => "torch" in value,
                )?.torch;
                if (torch !== undefined) {
                  fixture.constraints.push({
                    torch,
                    facing,
                    active: fixture.active,
                  });
                  if (!torch && request.torch && failTorchOff) {
                    if (failTorchOff === "reject") {
                      throw new DOMException(
                        "Fixture torch shutdown failure",
                        "NotReadableError",
                      );
                    }
                    return;
                  }
                  request.torch = torch;
                }
              },
            },
            stop: {
              value: () => {
                clearInterval(timer);
                nativeStop();
                request.torch = false;
              },
            },
          });
          return stream;
        } catch (error) {
          fixture.failures.push(String(error));
          throw error;
        }
      };
      const NativeRecorder = window.MediaRecorder;
      window.MediaRecorder = function (...args) {
        const recorder = new NativeRecorder(...args);
        const start = recorder.start.bind(recorder);
        recorder.start = (...startArgs) => {
          if (failStart)
            throw new DOMException(
              "Fixture startup failure",
              "NotSupportedError",
            );
          start(...startArgs);
          fixture.started += 1;
          fixture.active += 1;
        };
        recorder.addEventListener("stop", () => {
          fixture.stopped += 1;
          fixture.active -= 1;
        });
        fixture.recorders.push(recorder);
        return recorder;
      };
      window.MediaRecorder.isTypeSupported =
        NativeRecorder.isTypeSupported.bind(NativeRecorder);
    },
    options,
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(
      () =>
        document.querySelector(".live")?.videoWidth > 0 &&
        !document.querySelector('button[aria-label="Record"]')?.disabled,
    );
  } catch (error) {
    console.error(
      await page.evaluate(() => ({
        text: document.body.innerText,
        requests: window.cameraFlashFixture?.requests.length,
        failures: window.cameraFlashFixture?.failures,
        previewWidth: document.querySelector(".live")?.videoWidth,
        previewState: document.querySelector(".live")?.readyState,
      })),
      errors,
    );
    throw error;
  }
  return { context, page };
}

async function noLight(page) {
  await page.locator(lightSelector).waitFor({ state: "detached" });
}

async function arm(page) {
  const flash = page.getByRole("button", { name: "Flash", exact: true });
  await flash.click();
  assert.equal(await flash.getAttribute("aria-pressed"), "true");
  await noLight(page);
}

async function start(page, { screen = true } = {}) {
  await page.getByRole("button", { name: "Record", exact: true }).tap();
  await page.waitForFunction(() => cameraFlashFixture.active === 1);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .waitFor();
  if (screen) await page.locator(lightSelector).waitFor();
  else await noLight(page);
}

async function stop(page) {
  await page.getByRole("button", { name: "Stop recording", exact: true }).tap();
  await page.getByRole("button", { name: "Record", exact: true }).waitFor();
  await noLight(page);
  await page.waitForFunction(() => cameraFlashFixture.active === 0);
}

async function flip(page) {
  await page.getByRole("button", { name: "Flip camera", exact: true }).click();
  await page.waitForFunction(
    () =>
      cameraFlashFixture.requests.at(-1)?.facing === "environment" &&
      document.querySelector(".live")?.videoWidth > 0 &&
      !document.querySelector('button[aria-label="Flip camera"]')?.disabled,
  );
}

try {
  const front = await cameraPage();
  const page = front.page;
  await arm(page);
  assert.equal(await page.evaluate(() => cameraFlashFixture.started), 0);
  await page.getByRole("button", { name: "Timer", exact: true }).click();
  await page.getByRole("button", { name: "Record", exact: true }).tap();
  await page.locator(".countdown").waitFor();
  await noLight(page);
  assert.equal(await page.evaluate(() => cameraFlashFixture.started), 0);
  await page.getByRole("button", { name: "Record", exact: true }).tap();
  await page.locator(".countdown").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Timer", exact: true }).click();
  await page.getByRole("button", { name: "Timer", exact: true }).click();
  await start(page);
  const visibleLight = await page.evaluate((selector) => {
    const light = document.querySelector(selector);
    const style = getComputedStyle(light);
    const bounds = light.getBoundingClientRect();
    const stop = document.querySelector('button[aria-label="Stop recording"]');
    const stopBounds = stop.getBoundingClientRect();
    const hit = document.elementFromPoint(
      stopBounds.x + stopBounds.width / 2,
      stopBounds.y + stopBounds.height / 2,
    );
    return {
      position: style.position,
      pointerEvents: style.pointerEvents,
      color: style.backgroundColor,
      coversViewport:
        bounds.left <= 0 &&
        bounds.top <= 0 &&
        bounds.right >= innerWidth &&
        bounds.bottom >= innerHeight,
      stopReachable: stop === hit || stop.contains(hit),
    };
  }, lightSelector);
  assert.equal(visibleLight.position, "fixed");
  assert.equal(visibleLight.pointerEvents, "none");
  assert.match(visibleLight.color, /^rgba?\(255, 255, 255(?:, 0\.9\d*)?\)$/);
  assert(
    visibleLight.coversViewport && visibleLight.stopReachable,
    JSON.stringify(visibleLight),
  );
  if (process.env.CAMERA_FLASH_SCREENSHOT) {
    await page.screenshot({ path: process.env.CAMERA_FLASH_SCREENSHOT });
  }
  await page.waitForTimeout(550);
  await stop(page);
  await page.locator(".dockThumb video").waitFor();
  assert(
    await page
      .locator(".dockThumb video")
      .evaluate((video) => video.src.startsWith("blob:")),
    "A real recorded clip must survive the flash lifecycle",
  );

  const shutter = await page
    .getByRole("button", { name: "Record", exact: true })
    .boundingBox();
  await page.mouse.move(
    shutter.x + shutter.width / 2,
    shutter.y + shutter.height / 2,
  );
  await page.mouse.down();
  await page.locator(lightSelector).waitFor();
  await page.waitForTimeout(550);
  await page.mouse.up();
  await page.getByRole("button", { name: "Record", exact: true }).waitFor();
  await noLight(page);
  await page.waitForFunction(() => cameraFlashFixture.active === 0);
  assert.equal(await page.evaluate(() => cameraFlashFixture.started), 2);
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.waitForFunction(() =>
    cameraFlashFixture.requests.every(
      ({ track }) => track.readyState === "ended",
    ),
  );
  await noLight(page);
  await front.context.close();

  const failed = await cameraPage({ failStart: true });
  await arm(failed.page);
  await failed.page.getByRole("button", { name: "Record", exact: true }).tap();
  await failed.page
    .getByRole("button", { name: "Stop recording", exact: true })
    .waitFor();
  await failed.page.waitForTimeout(200);
  await noLight(failed.page);
  assert.equal(await failed.page.evaluate(() => cameraFlashFixture.started), 0);
  await stop(failed.page);
  await failed.context.close();

  const ended = await cameraPage();
  await arm(ended.page);
  await start(ended.page);
  await ended.page.evaluate(() => {
    const track = cameraFlashFixture.requests.at(-1).track;
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await noLight(ended.page);
  await ended.context.close();

  const unsupported = await cameraPage();
  await arm(unsupported.page);
  await flip(unsupported.page);
  assert.equal(
    await unsupported.page
      .getByRole("button", { name: "Flash", exact: true })
      .count(),
    0,
  );
  await start(unsupported.page, { screen: false });
  await stop(unsupported.page);
  assert.deepEqual(
    await unsupported.page.evaluate(() => cameraFlashFixture.constraints),
    [],
  );
  await unsupported.context.close();

  const rear = await cameraPage({ rearTorch: true });
  await flip(rear.page);
  await arm(rear.page);
  assert(
    !(await rear.page.evaluate(() =>
      cameraFlashFixture.constraints.some((item) => item.torch),
    )),
    "Arming rear flash must not turn the torch on before recording",
  );
  await start(rear.page, { screen: false });
  await rear.page.waitForFunction(
    () => cameraFlashFixture.requests.at(-1).torch,
  );
  assert(
    await rear.page.evaluate(() =>
      cameraFlashFixture.constraints
        .filter((item) => item.torch)
        .every((item) => item.active === 1),
    ),
    "Torch starts only while a real recorder is active",
  );
  await rear.page.getByRole("button", { name: "Flash", exact: true }).click();
  await rear.page.waitForFunction(
    () => !cameraFlashFixture.requests.at(-1).torch,
  );
  await rear.page.getByRole("button", { name: "Flash", exact: true }).click();
  await rear.page.waitForFunction(
    () => cameraFlashFixture.requests.at(-1).torch,
  );
  await stop(rear.page);
  await rear.page.waitForFunction(
    () => !cameraFlashFixture.requests.at(-1).torch,
  );
  await rear.context.close();

  for (const [failTorchOff, action] of [
    ["ignore", "stop"],
    ["reject", "toggle"],
  ]) {
    const recovery = await cameraPage({ rearTorch: true, failTorchOff });
    const page = recovery.page;
    await flip(page);
    await arm(page);
    await start(page, { screen: false });
    await page.waitForFunction(() => cameraFlashFixture.requests.at(-1).torch);
    await page.waitForTimeout(550);
    if (action === "stop") await stop(page);
    else await page.getByRole("button", { name: "Flash", exact: true }).click();
    await page.waitForFunction(
      () =>
        cameraFlashFixture.requests[1].track.readyState === "ended" &&
        cameraFlashFixture.active === 0,
    );
    await page
      .getByRole("heading", { name: "Camera is off", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Allow camera", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Record", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Flash", exact: true }).count(),
      0,
    );
    await noLight(page);
    await page.locator(".dockThumb video").waitFor();
    assert(
      await page
        .locator(".dockThumb video")
        .evaluate(
          async (video) =>
            video.src.startsWith("blob:") &&
            (await (await fetch(video.src)).blob()).size > 0,
        ),
      `${failTorchOff} torch shutdown after ${action} must preserve recorded footage`,
    );
    await page
      .getByRole("button", { name: "Allow camera", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        cameraFlashFixture.requests.length === 3 &&
        cameraFlashFixture.requests[2].track.readyState === "live" &&
        !cameraFlashFixture.requests[2].torch &&
        document.querySelector(".live")?.videoWidth > 0 &&
        !document.querySelector('button[aria-label="Record"]')?.disabled,
    );
    await page.getByRole("button", { name: "Flash", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => cameraFlashFixture.active), 0);
    assert.equal(
      await page
        .getByRole("heading", { name: "Camera is off", exact: true })
        .count(),
      0,
    );
    await noLight(page);
    await recovery.context.close();
  }

  const wrongFacing = await cameraPage({ actualFacing: "environment" });
  assert.equal(
    await wrongFacing.page
      .getByRole("button", { name: "Flash", exact: true })
      .count(),
    0,
    "Actual rear camera settings must prevent a front-screen flash even when a front camera was requested",
  );
  await wrongFacing.context.close();
  assert.deepEqual(errors, []);
  console.log(
    "Camera flash passed: real recorded clips, idle/countdown, tap/hold stop, failed startup, ended track, cleanup, unsupported rear, gated torch, failed torch shutdown recovery and actual facing.",
  );
} finally {
  await browser.close();
}
