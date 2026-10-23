import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const result = buildSync({
  entryPoints: ["editor/src/infrastructure/media/readVideo.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { readVideoMetadata } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("video metadata never invents source duration or geometry and releases its decoder", async (t) => {
  let video;
  let next;
  t.mock.method(globalThis, "setTimeout", (callback) => {
    next = callback;
    return 0;
  });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const original = globalThis.document;
  t.after(() => {
    globalThis.document = original;
  });
  for (const metadata of [
    { duration: 7.25, videoWidth: 1920, videoHeight: 1080 },
    ...[Infinity, NaN, 0].map((duration) => ({
      duration,
      videoWidth: 1920,
      videoHeight: 1080,
    })),
    { duration: 4, videoWidth: 0, videoHeight: 1080 },
    { duration: 4, videoWidth: 1920, videoHeight: 0 },
  ]) {
    video = {
      ...metadata,
      loads: 0,
      set src(value) {
        queueMicrotask(() => this.onloadedmetadata?.());
      },
      removeAttribute(name) {
        this.removed = name;
      },
      load() {
        this.loads++;
      },
    };
    globalThis.document = { createElement: () => video };
    const reading = readVideoMetadata("blob:fixture");
    if (metadata.duration === 7.25)
      assert.deepEqual(await reading, {
        duration: 7.25,
        width: 1920,
        height: 1080,
      });
    else await assert.rejects(reading, /couldn't be read.*retry/);
    assert.equal(video.removed, "src");
    assert.equal(video.loads, 1);
    assert.equal(video.onloadedmetadata, null);
    assert.equal(video.onerror, null);
  }
  video = { removeAttribute() {}, load() {} };
  globalThis.document = { createElement: () => video };
  const timeout = readVideoMetadata("blob:stalled");
  next();
  await assert.rejects(timeout, /too long.*again/);
  const controller = new AbortController();
  const aborted = readVideoMetadata("blob:aborted", controller.signal);
  controller.abort();
  await assert.rejects(aborted, { name: "AbortError" });
});
