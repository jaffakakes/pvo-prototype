import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { once } from "node:events";
import { test } from "node:test";
import { createRenderServer } from "../server/render/service.js";

function source(overrides = {}) {
  return {
    ratio: "9:16", quality: "720p", clips: [{
      id: 1, url: null, color: "#2ec4b6", srcDur: 1, in: 0, out: 1,
      speed: 1, zoom: 1, mirror: false, fit: "contain", width: 720, height: 1280,
    }],
    audioClips: [], texts: [], components: [], layers: ["video"], muted: false, sound: 0,
    ...overrides,
  };
}

test("private render service stores the generated MP4 and returns its metadata", async () => {
  let uploaded = null;
  const progress = [];
  const server = createRenderServer({
    render: async ({ outputPath, media, onProgress }) => {
      assert.equal(media.size, 0);
      onProgress(.5);
      onProgress(1);
      await writeFile(outputPath, Buffer.from("mp4-test"));
      return { path: outputPath, contentType: "video/mp4", durationSeconds: 1, width: 720, height: 1280 };
    },
    fetchImpl: async (_url, init) => {
      if (init.method === "POST") {
        progress.push(JSON.parse(init.body).fraction);
        return new Response(null, { status: 200 });
      }
      assert.equal(init.method, "PUT");
      assert.equal(init.headers["content-type"], "video/mp4");
      const chunks = [];
      for await (const chunk of init.body) chunks.push(chunk);
      uploaded = Buffer.concat(chunks).toString();
      return new Response(null, { status: 200 });
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/render`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "job_1", source: source(), assets: [], outputUrl: "https://example.test/storage/output?token=signed", progressUrl: "https://example.test/storage/progress?token=signed" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { duration: 1, bytes: 8, contentType: "video/mp4", width: 720, height: 1280 });
    assert.equal(uploaded, "mp4-test");
    assert.deepEqual(progress, [.5, 1]);
    const unsupported = await fetch(`http://127.0.0.1:${server.address().port}/render`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobId: "job_2", source: source({ sound: 1 }), assets: [], outputUrl: "https://example.test/storage/output?token=signed",
      }),
    });
    assert.equal(unsupported.status, 422);
    assert.equal((await unsupported.json()).code, "UNSUPPORTED_RENDER_FEATURE");
  } finally {
    server.close();
    await once(server, "close");
  }
});
