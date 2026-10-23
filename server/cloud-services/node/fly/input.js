import { nodeExecutionError } from "../protocol.js";
import { NODE_LIMITS } from "../runtime.js";

const chunkBytes = 6144;
const digest = async (bytes) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const encode = (bytes) => {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 32768)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(parts.join(""));
};
const partName = (index) => String(index).padStart(3, "0");

/** One byte-checked protocol for every invocation. No source fragment is interpreted as a shell command. */
export async function prepareFlyInput(body) {
  if (typeof body !== "string") throw nodeExecutionError("input_limit");
  const bytes = new TextEncoder().encode(body);
  if (!bytes.length || bytes.length > NODE_LIMITS.requestBytes)
    throw nodeExecutionError("input_limit");
  const firstBytes = 700000;
  const parts = [bytes.subarray(0, firstBytes)];
  for (let offset = firstBytes; offset < bytes.length; offset += chunkBytes)
    parts.push(bytes.subarray(offset, offset + chunkBytes));
  const manifest = {
    parts: parts.length,
    bytes: bytes.length,
    sha256: await digest(bytes),
  };
  return {
    parts,
    files: [
      {
        guest_path: "/control/invocation.json",
        mode: 384,
        raw_value: encode(new TextEncoder().encode(JSON.stringify(manifest))),
      },
      {
        guest_path: "/control/invocation/000",
        mode: 384,
        raw_value: encode(parts[0]),
      },
    ],
  };
}

/** Upload only after the preceding byte-checked part settles. Fly command admission owns pacing. */
export async function uploadFlyInput(
  machine,
  delivery,
  { signal, assertCurrent = () => {} } = {},
) {
  const deadline = Date.now() + NODE_LIMITS.uploadMs;
  const upload = async (part, index) => {
    signal?.throwIfAborted();
    assertCurrent();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw nodeExecutionError("upload_timeout");
    const output = await machine.command(
      [
        "/bin/sh",
        "-c",
        'umask 077; printf \'%s\' "$2" | /usr/bin/base64 --decode > "/control/invocation/$1" && /usr/bin/sha256sum "/control/invocation/$1"',
        "restyle-input",
        partName(index),
        encode(part),
      ],
      { timeoutMs: Math.min(10000, remaining), signal },
    );
    signal?.throwIfAborted();
    assertCurrent();
    if (
      output.trim() !==
      `${await digest(part)}  /control/invocation/${partName(index)}`
    )
      throw nodeExecutionError("runtime_mismatch");
  };
  for (let index = 1; index < delivery.parts.length; index++)
    await upload(delivery.parts[index], index);
}
