// pvom
export const textEncoder = new TextEncoder();

export const textDecoder = new TextDecoder();

export function bytesEqual(bytes, offset, target) {
  if (offset < 0 || offset + target.length > bytes.length) return false;
  return target.every((value, index) => bytes[offset + index] === value);
}

export function concatBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

export async function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input && typeof input.arrayBuffer === "function") {
    return new Uint8Array(await input.arrayBuffer());
  }
  throw new TypeError("PVO input must be a Blob, File, ArrayBuffer, or Uint8Array.");
}

export function inputSize(input) {
  if (typeof input?.size === "number") return input.size;
  if (input instanceof ArrayBuffer) return input.byteLength;
  if (ArrayBuffer.isView(input)) return input.byteLength;
  throw new TypeError("PVO input must expose its byte length.");
}

export async function readInputRange(input, start, end) {
  if (typeof input?.slice === "function" && typeof input?.arrayBuffer === "function") {
    return toBytes(input.slice(start, end));
  }
  const bytes = await toBytes(input);
  return bytes.subarray(start, end);
}

export async function inputStartsWith(input, signature) {
  if (inputSize(input) < signature.length) return false;
  const prefix = await readInputRange(input, 0, signature.length);
  return bytesEqual(prefix, 0, signature);
}

export async function inputSliceBlob(input, start, end, type) {
  if (typeof input?.slice === "function" && typeof input?.arrayBuffer === "function") {
    return input.slice(start, end, type);
  }
  const bytes = await toBytes(input);
  return new Blob([bytes.subarray(start, end)], { type });
}

export function mediaMimeType(input) {
  const type = String(input?.type || "").toLowerCase();
  const name = String(input?.name || "");
  return type === "video/quicktime" || /(?:\.pvo)?\.mov$/i.test(name) ? "video/quicktime" : "video/mp4";
}
