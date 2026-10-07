import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  prepareFlyInput,
  uploadFlyInput,
} from "../../server/cloud-services/node/fly/input.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("input delivery keeps create/exec requests small while retaining exact UTF-8 bytes", async () => {
  const body = JSON.stringify({
    source: '日本語";$(not-a-command)'.repeat(39000),
  });
  const delivery = await prepareFlyInput(body);
  assert.ok(JSON.stringify(delivery.files).length < 935000);
  const received = [Buffer.from(delivery.files[1].raw_value, "base64")];
  const machine = {
    command: async (args) => {
      assert.equal(args[0], "/bin/sh");
      const index = Number(args[4]);
      assert.match(args[4], /^\d{3}$/);
      assert.match(args[5], /^[A-Za-z0-9+/]*={0,2}$/);
      assert.ok(JSON.stringify(args).length < 10000);
      received[index] = Buffer.from(args[5], "base64");
      return `${hash(received[index])}  /control/invocation/${args[4]}\n`;
    },
  };
  await uploadFlyInput(machine, delivery);
  assert.equal(Buffer.concat(received).toString("utf8"), body);
  const manifest = JSON.parse(
    Buffer.from(delivery.files[0].raw_value, "base64"),
  );
  assert.equal(manifest.sha256, hash(Buffer.from(body)));
  assert.equal(manifest.bytes, Buffer.byteLength(body));
});

test("failed upload settles before rejection and never dispatches the next part", async () => {
  const delivery = await prepareFlyInput("x".repeat(900000));
  let calls = 0,
    settled = 0;
  const machine = {
    command: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      settled++;
      throw new Error("upload unavailable");
    },
  };
  await assert.rejects(uploadFlyInput(machine, delivery), /upload unavailable/);
  assert.equal(calls, 1);
  assert.equal(settled, 1);
});

test("cancelled upload cannot dispatch the next part", async () => {
  const delivery = await prepareFlyInput("x".repeat(900000));
  const controller = new AbortController();
  let calls = 0;
  const machine = {
    command: async () => {
      calls++;
      controller.abort();
      return "ignored";
    },
  };
  await assert.rejects(
    uploadFlyInput(machine, delivery, { signal: controller.signal }),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    uploadFlyInput(machine, delivery, { signal: controller.signal }),
  );
  assert.equal(calls, 1);
});
