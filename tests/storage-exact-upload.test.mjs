import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test(
  "exact uploads preserve streaming and conditional writes in the actual Workers runtime",
  { timeout: 30000 },
  async (t) => {
    const bundle = buildSync({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
    import { putExactBody } from './server/storage/exact-upload.js';
    export default { async fetch(request, env) {
      const query = new URL(request.url).searchParams;
      const mode = query.get('mode');
      let cancelled = false;
      const source = mode === 'stall' || mode === 'abort'
        ? new ReadableStream({ cancel() { cancelled = true; } }) : mode === 'source-error'
        ? new ReadableStream({ start(controller) { controller.error(new Error('Source failed')); } }) : request.body;
      const external = new AbortController();
      if (mode === 'abort') setTimeout(() => external.abort(), 20);
      const bucket = mode === 'failure' ? { async put(key, stream) {
        await new Response(stream).arrayBuffer(); throw new Error('Storage failed');
      } } : env.MEDIA;
      try {
        const stored = await putExactBody({ body: source, signal: mode === 'abort' ? external.signal : request.signal,
          headers: ['stream', 'stall', 'abort', 'source-error'].includes(mode) ? new Headers() : request.headers },
          bucket, query.get('key') || 'upload', Number(query.get('size') || 4),
          { timeoutMs: 100, httpMetadata: { contentType: 'video/mp4' } });
        return Response.json({ size: stored.size, type: stored.httpMetadata.contentType });
      } catch(error) { return Response.json({ code: error.code, cancelled }, { status: 400 }); }
    } };`,
      },
      bundle: true,
      write: false,
      format: "esm",
    });
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        name: "exact-upload-test",
        compatibilityDate: "2026-09-27",
        modules: [
          {
            type: "ESModule",
            path: "index.js",
            contents: bundle.outputFiles[0].text,
          },
        ],
        r2Buckets: ["MEDIA"],
      }),
    );
    t.after(() => runtime.dispose());
    const send = (query, body = "abcd") => {
      console.log("Exact upload runtime case: " + query);
      return runtime.dispatchFetch("https://upload.test/?" + query, {
        method: "PUT",
        body,
        headers: { "Content-Length": String(body.length) },
      });
    };
    const stored = await send("key=complete");
    assert.equal(stored.status, 200);
    assert.deepEqual(await stored.json(), { size: 4, type: "video/mp4" });
    assert.equal(
      (await (await send("key=complete")).json()).code,
      "conditional",
    );
    assert.equal(
      (await (await send("key=declared", "abc")).json()).code,
      "length",
    );
    for (const body of ["abc", "abcde"])
      assert.equal(
        (await (await send("mode=stream&key=" + body, body)).json()).code,
        "interrupted",
      );
    const stalled = await (await send("mode=stall&key=stalled")).json();
    assert.equal(stalled.code, "interrupted");
    assert.equal(
      stalled.cancelled,
      true,
      "The timed-out source is released before return",
    );
    const aborted = await (await send("mode=abort&key=aborted")).json();
    assert.equal(aborted.code, "interrupted");
    assert.equal(aborted.cancelled, true);
    assert.equal(
      (await (await send("mode=source-error&key=bad-source")).json()).code,
      "interrupted",
    );
    assert.equal(
      (await (await send("mode=failure&key=failed")).json()).code,
      "interrupted",
    );
  },
);
