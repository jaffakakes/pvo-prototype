import { readdir, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { sourceModules } from "./source-assets.mjs";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function playerFiles(directory, route) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory())
      files.push(...(await playerFiles(url, `${route}/${entry.name}`)));
    else if (types[extname(entry.name)]) {
      files.push([
        `${route}/${entry.name}`,
        { body: await readFile(url), type: types[extname(entry.name)] },
      ]);
    }
  }
  return files;
}

/** Serve the same player module, stylesheet and asset graph as the static build. */
export async function playerSourceAssets() {
  const root = new URL("../../../", import.meta.url);
  const assets = new Map(
    await playerFiles(new URL("player/", root), "/player"),
  );
  assets.set("/player/", assets.get("/player/index.html"));
  for (const directory of [
    "player",
    "packages/pvo-assistant",
    "packages/pvo-fonts",
    "packages/pvo-animation",
    "packages/pvo-sdk",
    "packages/pvo-code-runtime",
    "packages/pvo-component-runtime",
    "packages/pvo-text-runtime",
    "packages/pvo-language",
  ]) {
    for (const [path, asset] of await sourceModules(
      new URL(`${directory}/`, root),
      `/${directory}`,
    )) {
      assets.set(path, asset);
    }
  }
  for (const name of [
    "peace-sans",
    "open-sauce-600",
    "open-sauce-700",
    "open-sauce-800",
  ]) {
    assets.set(`/player/fonts/${name}.woff2`, {
      body: await readFile(new URL(`editor/src/fonts/${name}.woff2`, root)),
      type: "font/woff2",
    });
  }
  for (const [name, type] of [
    ["pvo_language.js", "text/javascript"],
    ["pvo_language_bg.wasm", "application/wasm"],
  ]) {
    const path = `packages/pvo-language/pkg/${name}`;
    assets.set(`/${path}`, { body: await readFile(new URL(path, root)), type });
  }
  return assets;
}
