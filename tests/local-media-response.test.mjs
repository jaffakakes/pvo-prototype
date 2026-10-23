import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sendMediaFile } from "../scripts/dev/media-response.mjs";

test("local video ranges return exact bytes, sizes and HTTP headers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "restyle-media-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "video.mp4");
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  await writeFile(file, bytes);
  const server = createServer((request, response) =>
    sendMediaFile(request, response, file, {
      size: bytes.length,
      type: "video/mp4",
      video: true,
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [range, start, end] of [
    ["bytes=-4", 996, 999],
    ["bytes=4-9", 4, 9],
    ["bytes=996-", 996, 999],
    ["bytes=-2000", 0, 999],
    ["bytes=995-2000", 995, 999],
  ]) {
    const response = await fetch(origin, { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(
      response.headers.get("content-range"),
      `bytes ${start}-${end}/1000`,
    );
    assert.equal(
      Number(response.headers.get("content-length")),
      end - start + 1,
    );
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      bytes.subarray(start, end + 1),
    );
  }
  for (const range of [
    "bytes=-",
    "bytes=-0",
    "bytes=1000-",
    "bytes=10-4",
    "bytes=0-4,9-12",
    "bytes=999999999999999999999-",
  ])
    assert.equal(
      (await fetch(origin, { headers: { Range: range } })).status,
      416,
    );
  const full = await fetch(origin);
  assert.equal(full.status, 200);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  const head = await fetch(origin, {
    method: "HEAD",
    headers: { Range: "bytes=-4" },
  });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get("content-length"), "4");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});
