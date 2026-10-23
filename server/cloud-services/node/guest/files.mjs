import { mkdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const ROOT = "/service";
const safeSource =
  /^(src|tests)\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_.-]*\.mjs$/;

/** Runs once, before generated imports. The outside controller independently validates this bundle. */
export async function restoreBundle(bundle) {
  if (
    !bundle ||
    !Array.isArray(bundle.files) ||
    bundle.files.length > 32 ||
    !safeSource.test(bundle.entrypoint) ||
    bundle.entrypoint.includes("..")
  )
    throw new Error("Invalid service bundle.");
  await mkdir(ROOT, { recursive: true });
  const seen = new Set();
  for (const file of bundle.files) {
    if (
      !safeSource.test(file.path) ||
      file.path.includes("..") ||
      seen.has(file.path) ||
      typeof file.content !== "string" ||
      Buffer.byteLength(file.content) > 128 * 1024
    )
      throw new Error("Invalid source file.");
    seen.add(file.path);
    // Generated tests and expected results never enter the invocation guest.
    if (file.path.startsWith("src/")) await write(file.path, file.content);
  }
  if (!seen.has(bundle.entrypoint) || !bundle.entrypoint.startsWith("src/"))
    throw new Error("Missing service entry point.");
  for (const dependency of bundle.dependencies ?? []) {
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/.test(dependency.name) ||
      !Array.isArray(dependency.files) ||
      dependency.files.length > 16
    )
      throw new Error("Invalid dependency bundle.");
    for (const file of dependency.files) {
      if (
        !/^(?:[a-z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(file.path) ||
        file.path.includes("..") ||
        typeof file.content !== "string" ||
        Buffer.byteLength(file.content) > 128 * 1024
      )
        throw new Error("Invalid dependency file.");
      await write(`node_modules/${dependency.name}/${file.path}`, file.content);
    }
  }
  return join(ROOT, bundle.entrypoint);
}

async function write(relative, content) {
  const target = join(ROOT, relative);
  await mkdir(join(target, ".."), { recursive: true });
  const file = await open(
    target,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(content);
  } finally {
    await file.close();
  }
}
