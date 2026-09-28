import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const excluded = new Set(["node_modules", "target", "pkg"]);

async function checkDirectory(directory) {
  let checked = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) checked += await checkDirectory(file);
    else if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status || 1);
      checked += 1;
    }
  }
  return checked;
}

let checked = 0;
for (const directory of ["packages", "player", "server", "scripts", "tests", "docs/site"]) {
  checked += await checkDirectory(resolve(root, directory));
}
console.log(`JavaScript syntax: ${checked} source modules passed.`);
