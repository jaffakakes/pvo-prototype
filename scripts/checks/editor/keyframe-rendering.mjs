import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const chromePath = process.env.CHROME_PATH || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "C:/Program Files/Google/Chrome/Application/chrome.exe");
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("console", message => { if (message.text().startsWith("keyframe-check:")) console.log(message.text()); });
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  console.log("keyframe-check: loaded");
  const results = await page.evaluate(async root => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { drawSceneFrame } = await import("/src/infrastructure/media/drawSceneFrame.ts");
    const { exportVideo } = await import("/src/infrastructure/media/exportVideo.ts");
    const { createOverlayRenderer } = await import(`/@fs/${root}/player/components/overlays.js`);
    const { registerComponentView } = await import(`/@fs/${root}/player/components/legacy-view.js`);
    registerComponentView();
    console.log("keyframe-check: imports");
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const track = (from, to, start = 0, end = 2) => [{ time: start, value: from, easing: "linear" }, { time: end, value: to, easing: "linear" }];
    const clip = { ...mkClip(8, null, 0), in: 4, out: 8, speed: 2,
      animation: { tracks: { x: track(0, 20, 4, 8), rotation: track(0, 40, 4, 8), opacity: track(1, 0, 4, 8) } } };
    const text = { id: 500, text: "Animated text", x: 50, y: 50, start: 0, end: 2, color: 0,
      animation: { tracks: { x: track(0, 20), scaleX: track(1, 2), rotation: track(0, 40) } } };
    useCapture.getState().patch({ clips: [clip], texts: [text], screen: "editor", t: 1, playing: false, ratio: "9:16" });
    await settle();
    const videoStyle = document.querySelector('.videoLayer').style;
    const preview = { transform: videoStyle.transform, opacity: videoStyle.opacity,
      textTransform: document.querySelector('.textOverlay').style.transform };
    useCapture.getState().patch({ t: 2 }); await settle();
    preview.endOpacity = document.querySelector('.videoLayer').style.opacity;
    useCapture.getState().patch({ t: 1 }); await settle();

    console.log("keyframe-check: preview");
    // Pixel comparison: the same source is rendered in a real <video> and through
    // the export/inspection painter with contain/cover, mirrored zoom and animation.
    const source = document.createElement("canvas"); source.width = 160; source.height = 90;
    const src = source.getContext("2d"); src.fillStyle = "#f00"; src.fillRect(0, 0, 80, 90); src.fillStyle = "#00f"; src.fillRect(80, 0, 80, 90);
    console.log("keyframe-check: source");
    const stream = source.captureStream(30); const video = document.createElement("video"); video.muted = true; video.srcObject = stream; await Promise.race([video.play(), new Promise((_, reject) => setTimeout(() => reject(new Error("Fixture play timed out")), 5000))]);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture video did not present a frame")), 5000);
      video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
      src.fillStyle = "#ff0101"; src.fillRect(0, 0, 80, 90);
      stream.getVideoTracks()[0].requestFrame?.();
    });
    const output = document.createElement("canvas"); output.width = 100; output.height = 100;
    const ctx = output.getContext("2d");
    const lower = { ...text, text: "", x: 50, y: 50, style: { background: "#00ff00", opacity: 1, size: 100 }, animation: undefined };
    const samples = [];
    for (const fit of ["cover", "contain"]) {
      const animated = { ...clip, color: "#f00", fit, zoom: 1.1, mirror: true,
        animation: { tracks: { x: track(0, 20), rotation: track(0, 30), scaleX: track(1, .8), opacity: track(1, 0) } } };
      drawSceneFrame(ctx, 100, 100, { clip: animated, video, sourceTime: 1, time: 1, texts: [lower], layers: [`text:${lower.id}`, "video"] });
      samples.push({ fit, centre: [...ctx.getImageData(50, 50, 1, 1).data], corner: [...ctx.getImageData(0, 0, 1, 1).data] });
    }
    video.pause(); stream.getTracks().forEach(item => item.stop());

    console.log("keyframe-check: pixels");
    // Keep a real form node, focus, typed value and selected choice while another
    // component appears and both motion/seek positions change in the player.
    const host = document.createElement("div"); host.style.cssText = "position:fixed;left:0;top:0;width:400px;height:700px";
    const overlay = document.createElement("div"); host.append(overlay); document.body.append(host);
    const form = { id: "motion-form", kind: "form", title: "Live form", fields: [{ name: "answer", label: "Answer", type: "text" }], submit_label: "Send",
      presentation: { scene: "main", start: 0, end: 5, x: .2, y: .2, width: .5, height: .5 },
      restyle_capture: { at: 0, x: 50, y: 50, animation: { tracks: { x: track(0, 20), rotation: track(0, 20) } }, form: { fields: [{ name: "answer", label: "Answer", type: "text" }] } } };
    const note = { id: "later-note", kind: "tooltip", text: "Hello", presentation: { scene: "main", start: 1, end: 2 }, restyle_capture: { x: 20, y: 20 } };
    const custom = { ...form, id: "custom-motion-form" };
    let time = 0;
    const session = { finished: false, captureMode: true, manifest: { canvas: { width: 9, height: 16 }, components: [form, note, custom], restyle_capture: { scene_layers: { main: { order: ["video", "component:motion-form", "component:later-note"], texts: [text] } } } },
      mountedCustom: new Map(), pvoLanguageSources: new Map([[custom.id, { html: '<form><input name="draft"><button type="submit">Send</button></form>', css: 'input { width: 100px; }', js: "", fields: {} }]]), pendingComponents: new Set(), capturedResponses: new Map(), currentTimeline: { id: "main" } };
    const renderer = createOverlayRenderer({ session, refs: { frame: host, overlay, video: document.createElement("video") }, adapters: {
      visibleComponents: () => time < 1 ? [form, custom] : [form, custom, note], activeClip: () => ({ scene: "main", start: 0, end: 5 }), elapsedTime: () => time,
    } });
    renderer.renderOverlays();
    const deadline = performance.now() + 5000;
    let sandboxInput;
    while (!sandboxInput && performance.now() < deadline) {
      sandboxInput = overlay.querySelector('iframe[sandbox="allow-same-origin"]')?.contentDocument?.querySelector('input');
      if (!sandboxInput) await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!sandboxInput) throw new Error("Animated sandbox did not become ready");
    sandboxInput.value = "Keep sandbox state";
    const sandboxFrame = overlay.querySelector('iframe[sandbox="allow-same-origin"]');
    const view = overlay.querySelector('pvo-component-view'); const input = view.shadowRoot.querySelector('input');
    input.value = "Keep this exact draft"; input.focus();
    time = 1; renderer.renderOverlays(); time = .5; renderer.renderOverlays();
    const retained = overlay.querySelector('pvo-component-view') === view && view.shadowRoot.querySelector('input') === input;
    const value = input.value; const focused = view.shadowRoot.activeElement === input;
    const sandboxRetained = overlay.querySelector('iframe[sandbox="allow-same-origin"]') === sandboxFrame
      && sandboxFrame.contentDocument.querySelector('input') === sandboxInput && sandboxInput.value === "Keep sandbox state";
    const playerTransform = view.parentElement.style.transform;
    renderer.destroyCustomOverlays(); host.remove();

    console.log("keyframe-check: retained");
    // A real MediaRecorder export exercises animated text/video plus automation.
    const result = await exportVideo({ ratio: "9:16", quality: "720p", clips: [{ ...mkClip(.4, null, 0),
      animation: { tracks: { opacity: track(1, 0, 0, .4) } } }], texts: [{ ...text, end: .4 }], components: [],
      audioClips: [], layers: ["video", `text:${text.id}`], muted: true, sound: 1,
      musicAnimation: { tracks: { gain: track(0, 1, 0, .4) } } }, () => {});
    const exportBytes = result.blob.size; URL.revokeObjectURL(result.url);
    return { preview, samples, retained, sandboxRetained, value, focused, playerTransform, exportBytes };
  }, root);
  const parity = [];
  for (const fit of ["cover", "contain"]) {
    await page.evaluate(async ({ fit, root }) => {
      const { drawSceneFrame } = await import("/src/infrastructure/media/drawSceneFrame.ts");
      const { drawText } = await import(`/@fs/${root}/packages/pvo-text-runtime/index.js`);
      const source = document.createElement("canvas"); source.width = 160; source.height = 90;
      const context = source.getContext("2d"); context.fillStyle = "red"; context.fillRect(0, 0, 80, 90);
      context.fillStyle = "blue"; context.fillRect(80, 0, 80, 90);
      const image = new Image(); image.src = source.toDataURL(); await image.decode();
      Object.defineProperties(image, { videoWidth: { value: 160 }, videoHeight: { value: 90 } });
      const text = { id: 1, text: "", x: 50, y: 50, start: 0, end: 2, style: { background: "#00ff00", size: 100 } };
      const fixture = document.createElement("div"); fixture.id = "keyframe-pixel-fixture";
      fixture.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px;overflow:hidden;background:black;z-index:2147483647;isolation:isolate";
      const beneath = document.createElement("canvas"); beneath.width = 100; beneath.height = 100;
      beneath.style.cssText = "position:absolute;inset:0;width:100px;height:100px";
      drawText(beneath.getContext("2d"), 100, 100, text, 1); fixture.append(beneath);
      const layer = document.createElement("div");
      layer.style.cssText = "position:absolute;inset:0;overflow:hidden;background:black;transform:translate(10%,0%) rotate(15deg) scale(.9,1.1);opacity:.5";
      image.style.cssText = `display:block;width:100%;height:100%;max-width:none;object-fit:${fit};transform:scale(-1.2,1.2)`;
      layer.append(image); fixture.append(layer); document.body.append(fixture);
      const track = value => [{ time: 1, value, easing: "linear" }];
      const result = document.createElement("canvas"); result.width = 100; result.height = 100;
      drawSceneFrame(result.getContext("2d"), 100, 100, { clip: { id: 1, fit, zoom: 1.2, mirror: true,
        animation: { tracks: { x: track(10), rotation: track(15), scaleX: track(.9), scaleY: track(1.1), opacity: track(.5) } } },
        video: image, sourceTime: 1, time: 1, texts: [text], layers: ["text:1", "video"] });
      window.keyframeReference = result;
    }, { fit, root });
    const screenshot = await page.locator("#keyframe-pixel-fixture").screenshot();
    const difference = await page.evaluate(async encoded => {
      const image = new Image(); image.src = "data:image/png;base64," + encoded; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 100;
      canvas.getContext("2d").drawImage(image, 0, 0);
      const actual = canvas.getContext("2d").getImageData(0, 0, 100, 100).data;
      const expected = window.keyframeReference.getContext("2d").getImageData(0, 0, 100, 100).data;
      let error = 0, mismatched = 0;
      for (let i = 0; i < actual.length; i += 4) {
        const delta = Math.max(...[0, 1, 2].map(offset => Math.abs(actual[i + offset] - expected[i + offset])));
        error += delta; if (delta > 12) mismatched++;
      }
      document.getElementById("keyframe-pixel-fixture").remove();
      return { averageError: error / 10000, mismatched: mismatched / 10000 };
    }, screenshot.toString("base64"));
    assert(difference.averageError < 3 && difference.mismatched < .05, `${fit} preview/export pixel parity: ${JSON.stringify(difference)}`);
    parity.push({ fit, ...difference });
  }
  assert.match(results.preview.transform, /translate\(10%, 0%\).*rotate\(20deg\)/);
  assert.equal(results.preview.opacity, "0.5");
  assert.equal(results.preview.endOpacity, "0", "Paused exact-end inspection holds source out-point keyframe");
  assert.match(results.preview.textTransform, /rotate\(20deg\) scale\(1.5, 1\)/);
  for (const sample of results.samples) assert(sample.centre[1] > 80, `${sample.fit}: animated video opacity reveals native text below`);
  assert.equal(results.sandboxRetained, true);
  assert.equal(results.retained, true); assert.equal(results.focused, true); assert.equal(results.value, "Keep this exact draft");
  assert.match(results.playerTransform, /rotate\(5deg\)/);
  assert(results.exportBytes > 1000);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...results, parity }, null, 2));
} finally { await browser.close(); }
