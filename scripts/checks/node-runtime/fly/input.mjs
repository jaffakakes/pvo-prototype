import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const chunkBytes = 6144;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const partName = (index) => String(index).padStart(3, "0");

/** One byte-checked protocol for every invocation. No source fragment is interpreted as a shell command. */
export function prepareFlyInput(body) {
  const bytes = Buffer.from(body);
  assert.ok(bytes.length > 0 && bytes.length <= 1152 * 1024);
  const firstBytes = 700000;
  const parts = [bytes.subarray(0, firstBytes)];
  for (let offset = firstBytes; offset < bytes.length; offset += chunkBytes)
    parts.push(bytes.subarray(offset, offset + chunkBytes));
  const manifest = {
    parts: parts.length,
    bytes: bytes.length,
    sha256: digest(bytes),
  };
  return {
    parts,
    files: [
      {
        guest_path: "/control/invocation.json",
        mode: 384,
        raw_value: Buffer.from(JSON.stringify(manifest)).toString("base64"),
      },
      {
        guest_path: "/control/invocation/000",
        mode: 384,
        raw_value: parts[0].toString("base64"),
      },
    ],
  };
}

/** Upload only after the preceding byte-checked part settles. Fly command admission owns pacing. */
export async function uploadFlyInput(machine, delivery) {
  const deadline = Date.now() + 100000;
  const upload = async (part, index) => {
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, "Invocation upload deadline reached");
    const output = await machine.command(
      [
        "/bin/sh",
        "-c",
        'umask 077; printf \'%s\' "$2" | /usr/bin/base64 --decode > "/control/invocation/$1" && /usr/bin/sha256sum "/control/invocation/$1"',
        "restyle-input",
        partName(index),
        part.toString("base64"),
      ],
      { timeoutMs: Math.min(10000, remaining) },
    );
    assert.equal(
      output.trim(),
      `${digest(part)}  /control/invocation/${partName(index)}`,
      "Uploaded input part changed",
    );
  };
  for (let index = 1; index < delivery.parts.length; index++)
    await upload(delivery.parts[index], index);
}
