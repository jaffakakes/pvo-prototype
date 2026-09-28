import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Bundle Worker JavaScript while keeping precompiled WASM as real workerd modules. */
export async function bundleWorkerModules(options) {
  const root = resolve(".wrangler/test-modules");
  const wasm = [];
  const bundled = await build({
    ...options,
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers"],
    plugins: [{ name: "worker-wasm", setup(builder) {
      builder.onResolve({ filter: /\.wasm$/ }, async args => {
        const name = `module-${wasm.length}.wasm`;
        const item = { type: "CompiledWasm", path: resolve(root, name) };
        wasm.push(item);
        item.contents = await readFile(resolve(args.resolveDir, args.path));
        return { path: `./${name}`, external: true };
      });
    } }],
  });
  return [{ type: "ESModule", path: resolve(root, "worker.mjs"), contents: bundled.outputFiles[0].text }, ...wasm];
}
