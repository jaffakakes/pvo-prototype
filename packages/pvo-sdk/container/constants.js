import { textEncoder } from "./binary.js";

export const PVO_CONTAINER_MIME = "application/vnd.pvo";

export const PVO_CONTAINER_VERSION = 1;

// 5a125a6e-8c7a-4ba8-9dd9-5e449a275056 (stable prototype UUID)
export const PVO_UUID = "5a125a6e-8c7a-4ba8-9dd9-5e449a275056";

export const PVO_UUID_BYTES = Uint8Array.from([
  0x5a, 0x12, 0x5a, 0x6e, 0x8c, 0x7a, 0x4b, 0xa8,
  0x9d, 0xd9, 0x5e, 0x44, 0x9a, 0x27, 0x50, 0x56,
]);

export const UUID_TYPE = Uint8Array.from([0x75, 0x75, 0x69, 0x64]);

export const MANIFEST_SUBTYPE = Uint8Array.from([0x70, 0x76, 0x6f, 0x6d]);

export const PVO_CONTAINER_MAGIC = textEncoder.encode("PVOPACK1");

export const PVO_CONTAINER_PREFIX_SIZE = 12;

export const PVO_CONTAINER_HEADER_LIMIT = 4 * 1024 * 1024;
