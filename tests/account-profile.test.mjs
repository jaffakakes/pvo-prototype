import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { profileResponse } from "../server/account/profile.js";
import { createLocalProfileApi } from "../scripts/dev/account-profile.mjs";

const origin = "https://getrestyle.app";
const user = { id: "account-a", name: "Maya" };
const body = { id: user.id, name: " Maya Rivera ", photo: null };
const request = (data = body, requestOrigin = origin) =>
  new Request(`${origin}/api/account/profile`, {
    method: "PUT",
    headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
test("profile writes require the live account, same origin and bounded raster data", async () => {
  const records = new Map();
  const adapter = {
    origin,
    user,
    read: (id) => records.get(id),
    write: (id, data) => records.set(id, data),
  };
  assert.equal(
    (await (await profileResponse(request(), adapter)).json()).name,
    "Maya Rivera",
  );
  assert.equal(records.size, 1);
  for (const [req, config, status] of [
    [request(), { ...adapter, user: null }, 401],
    [request(body, "https://evil.example"), adapter, 403],
    [request({ ...body, id: "another-account" }), adapter, 409],
    [request({ ...body, name: " " }), adapter, 400],
    [request({ ...body, photo: "data:image/svg+xml,<svg/>" }), adapter, 400],
    [
      request({
        ...body,
        photo: `data:image/jpeg;base64,/9j/${"A".repeat(90000)}`,
      }),
      adapter,
      400,
    ],
  ])
    await assert.rejects(
      profileResponse(req, config),
      (error) => error.status === status,
    );
  assert.deepEqual(records.get(user.id), { name: "Maya Rivera", photo: null });
  await assert.rejects(
    profileResponse(request(), {
      ...adapter,
      write: () => {
        throw new Error("offline");
      },
    }),
    /offline/,
  );
});
test("local profile storage survives restart and separates accounts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "restyle-profile-test-"));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const userFor = (req) =>
    req.headers.cookie ? { id: req.headers.cookie, name: "Creator" } : null;
  let handle = createLocalProfileApi({
    directory,
    origin: base,
    userFor,
    emailFor: async () => null,
  });
  server.on("request", (req, res) => handle(req, res));
  try {
    const put = await fetch(`${base}/api/account/profile`, {
      method: "PUT",
      headers: {
        Cookie: user.id,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.equal(put.status, 200);
    handle = createLocalProfileApi({
      directory,
      origin: base,
      userFor,
      emailFor: async () => null,
    });
    const read = (cookie) =>
      fetch(`${base}/api/account/profile`, {
        headers: { Cookie: cookie },
      }).then((response) => response.json());
    assert.equal((await read(user.id)).name, "Maya Rivera");
    assert.equal((await read("account-b")).name, "Creator");
    assert.equal((await fetch(`${base}/api/account/profile`)).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true });
  }
});
