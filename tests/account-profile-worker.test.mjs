import test from "node:test";
import assert from "node:assert/strict";
import { workerFixture } from "./publishing-server.helpers.mjs";

test("account profile route persists privately in R2 and rejects other-account writes", async () => {
  const f = await workerFixture();
  try {
    const current = await (await f.request("/api/account/profile")).json();
    assert.equal(current.name, "First creator");
    const write = (data, options = {}) =>
      f.request("/api/account/profile", {
        method: "PUT",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
        ...options,
      });
    const profile = {
      ...current,
      name: "Maya Rivera",
      photo: "data:image/jpeg;base64,/9j/2Q==",
    };
    assert.equal((await write(profile)).status, 200);
    assert.deepEqual(
      await (await f.request("/api/account/profile")).json(),
      profile,
    );
    assert.equal(
      (
        await (
          await f.request("/api/account/profile", { session: f.otherCookie })
        ).json()
      ).photo,
      null,
    );
    assert.equal(
      (await write(profile, { session: f.otherCookie })).status,
      409,
    );
    assert.equal(
      (await f.request("/api/account/profile", { session: null })).status,
      401,
    );
    assert.equal(
      (
        await write(profile, {
          headers: {
            Origin: "https://wrong.example",
            "Content-Type": "application/json",
          },
        })
      ).status,
      403,
    );
    const objects = await f.bucket.list({ prefix: "account-profiles/" });
    assert.equal(objects.objects.length, 1);
    assert.equal(
      (await f.bucket.get(objects.objects[0].key)).httpMetadata.contentType,
      "application/json",
    );
  } finally {
    await f.close();
  }
});
