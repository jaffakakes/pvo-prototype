import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = resolve(root, "dist");

if (dirname(dist) !== resolve(root)) throw new Error("Build output must be inside the repository root.");
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "editor"), { recursive: true });
await mkdir(resolve(dist, "packages/pvo-language"), { recursive: true });
// Product deployment is independent of the PVO documentation and demo fixtures.
await cp(resolve(root, "editor/deployment"), dist, { recursive: true });
// Copy module trees so new relative imports also exist in static output.
await cp(resolve(root, "player"), resolve(dist, "player"), { recursive: true });
const browserFiles = source => !/\.(?:md|ts)$/.test(source) && !source.endsWith("package.json");
for (const name of ["pvo-sdk", "pvo-code-runtime", "pvo-text-runtime", "pvo-component-runtime"]) {
  await cp(resolve(root, "packages", name), resolve(dist, "packages", name), {
    recursive: true, filter: browserFiles,
  });
}
// The Rust source and Cargo target cache are not browser assets.
await cp(resolve(root, "packages/pvo-language/index.js"), resolve(dist, "packages/pvo-language/index.js"));
await cp(resolve(root, "packages/pvo-language/result.js"), resolve(dist, "packages/pvo-language/result.js"));
await cp(resolve(root, "packages/pvo-language/pkg"), resolve(dist, "packages/pvo-language/pkg"), {
  recursive: true, filter: browserFiles,
});
await cp(resolve(root, "editor/src/fonts"), resolve(dist, "player/fonts"), { recursive: true });
