import assert from "node:assert/strict";
import test from "node:test";
import { create } from "../assistant-tasks/fixtures.mjs";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import {
  parseServiceObservation,
  parseServicePublication,
} from "../../packages/pvo-assistant/releases/index.js";
import { serviceProvider } from "../../server/assistant/tasks/serviceProvider.js";

test("provider wire data is strictly validated and RPC resources are disposed even on rejection", async () => {
  const { identity } = await prepareServicePublication(
    create(),
    "publish",
    "export default {};",
  );
  for (const change of [
    {},
    { state: "invented" },
    { extra: true },
    { extra: undefined },
    { identity: { ...identity, ownerId: "another-owner" } },
  ]) {
    let disposed = 0;
    const result = {
      identity,
      state: "available",
      ...change,
      [Symbol.dispose]() {
        disposed++;
      },
    };
    const provider = serviceProvider({
      SERVICE_RELEASES: {
        getByName(name) {
          assert.equal(name, identity.resourceId);
          return { lookup: async () => result };
        },
      },
    });
    if (Object.keys(change).length)
      await assert.rejects(provider.lookup(identity));
    else
      assert.deepEqual(await provider.lookup(identity), {
        identity,
        state: "available",
      });
    assert.equal(disposed, 1);
  }
  assert.throws(() =>
    parseServiceObservation(
      { identity, state: "available", [Symbol.dispose]() {} },
      identity,
    ),
  );
});

test("release identity is derived from the saved task and source bytes have a total bound", async () => {
  const task = create();
  const first = await prepareServicePublication(
    task,
    "publish",
    "export default {};",
  );
  const same = await prepareServicePublication(
    task,
    "publish",
    "export default {};",
  );
  assert.deepEqual(first, same);
  const changed = await prepareServicePublication(
    task,
    "publish",
    "export default { changed: true };",
  );
  assert.equal(
    changed.identity.resourceId,
    first.identity.resourceId,
    "A changed source cannot hide behind a new owned identity",
  );
  assert.notEqual(changed.identity.sourceDigest, first.identity.sourceDigest);
  const foreign = await prepareServicePublication(
    { ...task, ownerId: "other" },
    "publish",
    first.source,
  );
  assert.notEqual(foreign.identity.resourceId, first.identity.resourceId);
  assert.throws(() =>
    parseServicePublication({ ...first, source: "é".repeat(1024 * 1024) }),
  );
  assert.throws(() =>
    parseServicePublication({ ...first, credential: "not-allowed" }),
  );
});
