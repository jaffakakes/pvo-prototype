import { readdir, readFile } from "node:fs/promises";

/** Read source modules for fixture servers, including their relative imports. */
export async function sourceModules(directory, route) {
  const assets = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "target", "pkg"].includes(entry.name)) continue;
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) assets.push(...await sourceModules(url, `${route}/${entry.name}`));
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      assets.push([`${route}/${entry.name}`, { body: await readFile(url), type: "text/javascript" }]);
    }
  }
  return assets;
}
