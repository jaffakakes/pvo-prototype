import assert from "node:assert/strict";
import test from "node:test";
import { bundleWorkerModules } from "./worker-bundle.helpers.mjs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = "https://releases.example";
const token = "release-test-secret-only";
const first = "restyle-editor-shell-1111111111111111";
const second = "restyle-editor-shell-2222222222222222";

test("release channel protects announcements, broadcasts, and replays persisted revisions", async () => {
  const modules = await bundleWorkerModules({ entryPoints: ["server/worker.js"] });
  const persist = await mkdtemp(join(tmpdir(), "pvo-release-test-"));
  let deployed = first;
  const options = () => convertV4MiniflareOptions({ name: "release-test", modules,
    compatibilityDate: "2026-09-27",
    durableObjects: { RELEASES: { className: "ReleaseChannel", useSQLite: true } },
    isolatedResourcePersistencePath: persist,
    resourcePersistencePath: persist,
    bindings: { RELEASE_NOTIFY_TOKEN: token },
    serviceBindings: { ASSETS: () => Response.json({ revision: deployed }) },
  });
  let mf = new Miniflare(options());
  const sockets = [];
  const announce = (revision, secret = token) => mf.dispatchFetch(`${origin}/api/releases/announce`, {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ revision }),
  });
  async function connect() {
    const response = await mf.dispatchFetch(`${origin}/api/releases/connect`, {
      headers: { Upgrade: "websocket", Origin: origin },
    });
    assert.equal(response.status, 101);
    const socket = response.webSocket;
    const messages = [];
    socket.addEventListener("message", event => messages.push(JSON.parse(event.data)));
    socket.accept();
    sockets.push(socket);
    return messages;
  }
  async function expectRevision(messages, revision) {
    for (let count = 0; count < 100 && messages.at(-1)?.revision !== revision; count++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(messages.at(-1)?.revision, revision);
  }
  try {
    assert.equal((await announce(first, "incorrect")).status, 401);
    assert.equal((await announce("malformed")).status, 400);
    assert.equal((await announce(second)).status, 409, "Undeployed builds cannot be announced");
    assert.equal((await mf.dispatchFetch(`${origin}/api/releases/connect`, {
      headers: { Upgrade: "websocket", Origin: "https://other.example" },
    })).status, 403);
    assert.equal((await mf.dispatchFetch(`${origin}/api/releases/connect`, {
      headers: { Origin: origin },
    })).status, 426);
    const a = await connect();
    const b = await connect();
    assert.equal((await announce(first)).status, 200);
    await expectRevision(a, first);
    await expectRevision(b, first);
    await announce(first);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(a.length, 1, "Duplicate deployment calls must not rebroadcast");
    deployed = second;
    await announce(second);
    await expectRevision(a, second);
    await expectRevision(b, second);
    await expectRevision(await connect(), second);
    for (const socket of sockets.splice(0)) socket.close();
    await mf.dispose();
    mf = new Miniflare(options());
    await expectRevision(await connect(), second);
  } finally {
    for (const socket of sockets) socket.close();
    await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  }
});
