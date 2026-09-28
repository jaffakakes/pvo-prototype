import test from "node:test";
import assert from "node:assert/strict";
import { inspectPvoProject, readPvoProject } from "../packages/pvo-sdk/index.js";
import { tinyPvo } from "./publishing-server.helpers.mjs";

test("bounded PVO inspection validates the same manifest without reading media", async () => {
  const blob = await tinyPvo();
  const reads = [];
  const source = { size: blob.size, readRange: async (start, end) => {
    reads.push({ start, end });
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  } };
  const result = await inspectPvoProject(source);
  assert(result.validation.valid);
  assert(reads.every(read => read.end <= result.payloadStart));
  const decoded = await readPvoProject(blob);
  assert.deepEqual(decoded.manifest, result.manifest);
  assert.equal(decoded.assets[0].size, result.assets[0].length);
  await assert.rejects(inspectPvoProject(source, { maxHeaderBytes: 20 }), /header length/);
  await assert.rejects(inspectPvoProject({ ...source, size: blob.size - 1 }), /invalid byte range/);
});
