import test from "node:test";
import assert from "node:assert/strict";
import { fixtureMediaResponse } from "./mediaFixture.mjs";

const bytes = Buffer.from("0123456789");

test("fixture delivers the exact full file and advertises seekability", () => {
  const response = fixtureMediaResponse(bytes);
  assert.equal(response.status, 200);
  assert.equal(response.headers["Accept-Ranges"], "bytes");
  assert.equal(response.headers["Content-Length"], "10");
  assert.deepEqual(response.body, bytes);
});

test("fixture honors browser open-ended seeks and bounded or suffix ranges", () => {
  for (const [range, expected, contentRange] of [
    ["bytes=0-", "0123456789", "bytes 0-9/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=3-5", "345", "bytes 3-5/10"],
    ["bytes=8-100", "89", "bytes 8-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
  ]) {
    const response = fixtureMediaResponse(bytes, range);
    assert.equal(response.status, 206, range);
    assert.equal(response.headers["Content-Range"], contentRange);
    assert.equal(response.headers["Content-Length"], String(expected.length));
    assert.equal(response.body.toString(), expected);
  }
});

test("unavailable and malformed ranges cannot masquerade as successful media", () => {
  for (const range of ["bytes=10-", "bytes=8-2", "bytes=-0", "bytes=-", "bytes=0-1,4-5", "bytes=999999999999999999-", "nonsense"]) {
    const response = fixtureMediaResponse(bytes, range);
    assert.equal(response.status, 416, range);
    assert.equal(response.headers["Content-Range"], "bytes */10");
    assert.equal(response.body.length, 0);
  }
});
