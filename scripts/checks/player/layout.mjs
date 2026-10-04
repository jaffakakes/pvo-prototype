import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { playerSourceAssets } from "../helpers/player-assets.mjs";

const assets = await playerSourceAssets();
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Player layout check</title>");
    return;
  }
  const asset = assets.get(path);
  if (!asset) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "content-type": asset.type }).end(asset.body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true, args: ["--no-sandbox"],
  });
  for (const [custom, animated] of [[false, false], [true, false], [false, true]]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.setContent(`<link rel="stylesheet" href="/player/styles.css">
      <div class="player-shell"><div class="player-frame" data-state="waiting">
        <video></video><canvas></canvas><div class="overlay-layer"></div>
        <div class="keyboard-accessory"><button id="done">Done</button></div>
      </div></div>`);
    const result = await page.evaluate(async ({ custom, animated }) => {
      const [{ createPlayerLayout }, { createOverlayRenderer }, { createPlaybackSession }, { registerComponentView }]
        = await Promise.all([
          import("/player/ui/layout.js"), import("/player/components/overlays.js"),
          import("/player/playback/session.js"), import("/player/components/legacy-view.js"),
        ]);
      registerComponentView();
      const shell = document.querySelector(".player-shell");
      const frame = document.querySelector(".player-frame");
      const overlay = document.querySelector(".overlay-layer");
      const video = document.querySelector("video");
      const viewport = new EventTarget();
      Object.assign(viewport, { height: 844, width: 390, scale: 1 });
      Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
      const session = createPlaybackSession();
      let elapsed = 0;
      const component = {
        id: "form", kind: "form", fields: [{ name: "email", type: "email", label: "Email" }],
        submit_label: "Send", presentation: { scene: "main", start: 0, end: 5 },
        restyle_capture: { x: 50, y: 84, ...(animated ? { animation: { tracks: {
          x: [{ time: 0, value: 0, easing: "linear" }, { time: 4, value: 100, easing: "linear" }],
          opacity: [{ time: 0, value: 1, easing: "linear" }, { time: 4, value: 0, easing: "linear" }],
        } } } : {}) },
      };
      session.captureMode = true;
      session.manifest = { canvas: { width: 9, height: 16 }, components: [component] };
      if (custom) session.pvoLanguageSources.set(component.id, {
        html: '<form><input name="email" type="email"><button type="submit">Send</button></form>',
        css: "form{box-sizing:border-box;width:190px;height:96px;background:white;padding:8px}input{box-sizing:border-box;width:100%;height:40px}button{height:40px}",
        js: "", fields: {},
      });
      const overlays = createOverlayRenderer({ session, refs: { frame, video, overlay }, adapters: {
        visibleComponents: () => [component], activeClip: () => ({ scene: "main" }), elapsedTime: () => elapsed,
        setStatus: message => { throw new Error(message); },
      } });
      const layout = createPlayerLayout({ session, refs: {
        shell, frame, overlay, video, ambient: document.querySelector("canvas"),
        keyboardDone: document.querySelector("#done"),
      } });
      overlays.renderOverlays();
      const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
      let input;
      for (let attempt = 0; attempt < 100 && !input; attempt++) {
        input = custom ? overlay.querySelector("iframe")?.contentDocument?.querySelector("input")
          : overlay.querySelector("pvo-component-view")?.shadowRoot.querySelector("input");
        if (!input) await delay(20);
      }
      if (!input) throw new Error("The authored form did not mount.");
      input.value = "saved@example.com";
      input.focus();
      viewport.height = 480;
      viewport.dispatchEvent(new Event("resize"));
      await delay(150);
      const position = overlay.querySelector(".component-position");
      const before = position.getBoundingClientRect().toJSON();
      for (let index = 0; index < 40; index++) layout.update();
      const after = position.getBoundingClientRect().toJSON();
      const lifted = position.dataset.lifted;
      const keyboard = shell.dataset.keyboard;
      const focused = input.getRootNode().activeElement === input;
      const value = input.value;
      const originalInput = input;
      overlays.renderOverlays();
      const retained = originalInput.isConnected;
      document.querySelector("#done").click();
      await delay(40);
      const restored = { keyboard: shell.dataset.keyboard, lifted: position.dataset.lifted };
      elapsed = 4;
      overlays.renderOverlays();
      layout.update();
      const motion = { left: position.style.left, opacity: position.style.opacity,
        visibility: position.style.visibility, lift: position.style.getPropertyValue("--component-lift-x"),
        retained: originalInput.isConnected, value: originalInput.value };
      layout.destroy();
      overlays.destroyCustomOverlays();
      return { before, after, lifted, keyboard, focused, value, retained, restored, motion };
    }, { custom, animated });
    const label = custom ? "sandbox form" : animated ? "animated form" : "native form";
    assert.equal(result.keyboard, "true", label);
    assert.equal(result.lifted, "keyboard", label);
    assert.equal(result.focused, true, label);
    assert.equal(result.retained, true, label);
    assert.equal(result.value, "saved@example.com", label);
    for (const dimension of ["left", "top", "width", "height"]) {
      assert.ok(Math.abs(result.before[dimension] - result.after[dimension]) < .05,
        `${label} must not drift on repeated layout updates (${dimension})`);
    }
    assert.ok(result.before.bottom <= 436, `${label} must fit above the Done accessory`);
    assert.equal(result.restored.keyboard, "false", label);
    assert.equal(result.restored.lifted, "", label);
    if (animated) {
      assert.equal(result.motion.left, "150%", "Authored movement can leave the footage");
      assert.equal(result.motion.opacity, "0", "Authored fades survive layout updates");
      assert.equal(result.motion.visibility, "hidden");
      assert.equal(result.motion.lift, "0px", "Layout must not pull an animated exit back on-screen");
      assert.equal(result.motion.retained, true, "Fading must preserve the existing form DOM");
      assert.equal(result.motion.value, "saved@example.com");
    }
    assert.deepEqual(errors, [], label);
    await page.close();
  }
  console.log("Player layout passed: native and sandbox form retention, keyboard lifting, stable layout, and authored animation after Done restoration.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
