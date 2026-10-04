import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/features/export/previewUrl.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { ownPreviewUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("a completed preview owns one URL and releases it exactly once", async (t) => {
  const revoked = [];
  const revoke = URL.revokeObjectURL.bind(URL);
  t.mock.method(URL, "revokeObjectURL", (url) => {
    revoked.push(url);
    revoke(url);
  });
  let shown;
  const dispose = ownPreviewUrl(
    () => new Blob(["cover"]),
    (url) => {
      shown = url;
    },
    assert.fail,
  );
  await settle();
  assert.equal(await (await fetch(shown)).text(), "cover");
  dispose();
  dispose();
  assert.deepEqual(revoked, [shown]);
  await assert.rejects(fetch(shown));
});

test("replacement cancels a pending capture and a late result cannot overwrite its successor", async () => {
  const first = deferred();
  let oldSignal;
  const shown = [];
  const disposeOld = ownPreviewUrl(
    (signal) => {
      oldSignal = signal;
      return first.promise;
    },
    (url) => shown.push(url),
    assert.fail,
  );
  await settle();
  disposeOld();
  assert.equal(oldSignal.aborted, true);
  const disposeNew = ownPreviewUrl(
    () => new Blob(["new"]),
    (url) => shown.push(url),
    assert.fail,
  );
  await settle();
  first.resolve(new Blob(["obsolete"]));
  await settle();
  assert.equal(shown.length, 1);
  assert.equal(await (await fetch(shown[0])).text(), "new");
  disposeNew();
});

test("active loading failures are reported; disposal suppresses late failures and avoids starting cancelled work", async () => {
  const errors = [];
  const failure = new Error("decoder failed");
  const disposeFailed = ownPreviewUrl(
    () => Promise.reject(failure),
    assert.fail,
    (error) => errors.push(error),
  );
  await settle();
  assert.deepEqual(errors, [failure]);
  disposeFailed();
  const pending = deferred();
  const disposePending = ownPreviewUrl(
    () => pending.promise,
    assert.fail,
    (error) => errors.push(error),
  );
  await settle();
  disposePending();
  pending.reject(new Error("obsolete failure"));
  const disposeImmediate = ownPreviewUrl(
    () => {
      assert.fail("Cancelled capture started");
    },
    assert.fail,
    assert.fail,
  );
  disposeImmediate();
  await settle();
  assert.deepEqual(errors, [failure]);
});
