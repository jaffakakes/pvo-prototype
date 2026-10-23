import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Trusted build inputs only. An immutable digest is required before any downloaded program runs. */
export async function downloadVerified(
  url,
  path,
  algorithm,
  expected,
  maximum,
) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok)
    throw new Error(`Build input download failed (${response.status})`);
  const hash = createHash(algorithm);
  let bytes = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > maximum)
          return done(new Error("Build input exceeded its byte limit"));
        hash.update(chunk);
        done(null, chunk);
      },
    }),
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
  );
  if (hash.digest("hex") !== expected)
    throw new Error("Build input digest mismatch");
  return bytes;
}
