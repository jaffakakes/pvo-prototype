import assert from "node:assert/strict";
import test from "node:test";
import { FlyMachineLifecycle } from "../../server/cloud-services/node/fly/lifecycle.js";

const execution = "00000000-0000-4000-8000-000000000001";
const image = "registry.fly.io/restyle-owned@sha256:" + "a".repeat(64);
const ok = (data) => ({ ok: true, status: 200, data });
const absent = { ok: false, status: 404, data: null };
const machine = (extra = {}) => ({
  id: "1234567890abcd",
  name: `restyle-${execution}`,
  state: "started",
  config: { metadata: { restyle_execution: execution } },
  image_ref: { digest: image.split("@")[1] },
  ...extra,
});
function fixture(request) {
  let record = null;
  const options = {
    app: "restyle-owned",
    image,
    request: (...args) => request(...args),
    read: () => structuredClone(record),
    write: (value) => {
      record = structuredClone(value);
    },
  };
  return { open: () => new FlyMachineLifecycle(options), read: options.read };
}

test("an uncertain creation holds its durable obligation through restart and late arrival", async () => {
  let present = false,
    creates = 0,
    deletes = 0;
  const f = fixture(async (method, path) => {
    if (method === "POST") {
      creates++;
      assert.equal(f.read().phase, "dispatching");
      throw new TypeError("lost reply");
    }
    if (method === "DELETE") {
      deletes++;
      present = false;
      return ok({});
    }
    if (path.endsWith("/machines")) return ok(present ? [machine()] : []);
    return present ? ok(machine()) : absent;
  });
  await assert.rejects(
    f.open().create(execution, { config: {} }),
    /lost reply/,
  );
  const restarted = f.open();
  await assert.rejects(restarted.destroy(execution), {
    code: "cleanup_unconfirmed",
  });
  assert.equal(f.read().phase, "dispatching");
  await assert.rejects(restarted.create(execution, { config: {} }), {
    code: "execution_closed",
  });
  present = true;
  await restarted.destroy(execution);
  assert.equal(f.read(), null);
  assert.equal(creates, 1);
  assert.equal(deletes, 1);
});

test("a lost deletion reply is recovered by identity without repeating creation or deleting another Machine", async () => {
  let present = true,
    deletes = 0;
  const f = fixture(async (method) => {
    if (method === "POST") return ok(machine());
    if (method === "DELETE") {
      deletes++;
      present = false;
      throw new TypeError("delete reply lost");
    }
    return present ? ok(machine()) : absent;
  });
  await f.open().create(execution, { config: {} });
  await assert.rejects(f.open().destroy(execution), /delete reply lost/);
  assert.equal(f.read().phase, "destroying");
  await f.open().destroy(execution);
  assert.equal(f.read(), null);
  assert.equal(deletes, 1);
});

test("cleanup preserves foreign or changed compute and retains unconfirmed deletion", async () => {
  for (const changed of [
    machine({ id: "abcdef12345678" }),
    machine({ name: "foreign" }),
    machine({ config: { metadata: { restyle_execution: "different" } } }),
    machine({ image_ref: { digest: "sha256:" + "b".repeat(64) } }),
  ]) {
    let deletes = 0;
    const f = fixture(async (method) => {
      if (method === "POST") return ok(machine());
      if (method === "DELETE") deletes++;
      return ok(changed);
    });
    await f.open().create(execution, { config: {} });
    await assert.rejects(f.open().destroy(execution), {
      code: "runtime_mismatch",
    });
    assert.ok(f.read());
    assert.equal(deletes, 0);
  }
  const f = fixture(async (method) =>
    method === "DELETE" ? ok({}) : ok(machine()),
  );
  await f.open().create(execution, { config: {} });
  await assert.rejects(f.open().destroy(execution), {
    code: "cleanup_unconfirmed",
  });
  assert.equal(f.read().phase, "destroying");
});

test("definite create rejection can release its intent while ambiguous server errors cannot", async () => {
  for (const status of [400, 429, 503]) {
    const f = fixture(async (method) =>
      method === "POST" ? { ok: false, status } : ok([]),
    );
    await assert.rejects(f.open().create(execution, { config: {} }), {
      code: "runtime_unavailable",
    });
    if (status === 503) {
      await assert.rejects(f.open().destroy(execution), {
        code: "cleanup_unconfirmed",
      });
      assert.ok(f.read());
    } else {
      await f.open().destroy(execution);
      assert.equal(f.read(), null);
    }
  }
});
