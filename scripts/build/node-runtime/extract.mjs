import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";

/** Extract only a previously digest-verified official archive; bound expanded bytes and process lifetime. */
export async function extractSandbox(archive, destination) {
  const child = spawn(
    "tar",
    ["-xf", "-", "-C", destination, "--exclude=containerd-shim-runsc-v1"],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Sandbox extraction failed")),
    );
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
  let bytes = 0;
  try {
    await Promise.all([
      completed,
      pipeline(
        createReadStream(archive),
        createZstdDecompress(),
        new Transform({
          transform(chunk, _, done) {
            bytes += chunk.length;
            if (bytes > 1024 * 1024 * 1024)
              return done(new Error("Expanded sandbox exceeds its byte limit"));
            done(null, chunk);
          },
        }),
        child.stdin,
      ),
    ]);
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
  }
}
