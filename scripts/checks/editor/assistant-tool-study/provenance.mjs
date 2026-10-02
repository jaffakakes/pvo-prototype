import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const sha256 = value => createHash("sha256").update(value).digest("hex");

/** Freeze executable source, including uncommitted modules, without reading credentials. */
export async function sourceManifest(root) {
  const files = [];
  const visit = async relative => {
    for (const item of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(relative, item.name);
      if (item.isDirectory()) await visit(target);
      else if (item.isFile() && /\.(?:ts|tsx|js|mjs|css)$/.test(item.name)) {
        files.push({ path: target, sha256: sha256(await readFile(path.join(root, target))) });
      }
    }
  };
  for (const directory of ["editor/src", "packages/pvo-assistant", "packages/pvo-code-runtime", "packages/pvo-component-runtime", "packages/pvo-text-runtime", "packages/pvo-sdk", "server/assistant", "scripts/checks/editor/assistant-tool-study"]) await visit(directory);
  for (const relative of ["packages/pvo-language/index.js", "packages/pvo-language/pkg/pvo_language.js", "packages/pvo-language/pkg/pvo_language_bg.wasm"]) {
    files.push({ path: relative, sha256: sha256(await readFile(path.join(root, relative))) });
  }
  return { sha256: sha256(JSON.stringify(files)), files };
}
