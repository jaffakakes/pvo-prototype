import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("../", import.meta.url).pathname);
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "player"), { recursive: true });
await mkdir(resolve(dist, "editor"), { recursive: true });
await mkdir(resolve(dist, "packages/pvo-sdk"), { recursive: true });
await cp(resolve(root, "share/index.html"), resolve(dist, "index.html"));
await cp(resolve(root, "player/index.html"), resolve(dist, "player/index.html"));
await cp(resolve(root, "player/app.js"), resolve(dist, "player/app.js"));
await cp(resolve(root, "player/styles.css"), resolve(dist, "player/styles.css"));
await cp(resolve(root, "editor/index.html"), resolve(dist, "editor/index.html"));
await cp(resolve(root, "editor/app.js"), resolve(dist, "editor/app.js"));
await cp(resolve(root, "editor/styles.css"), resolve(dist, "editor/styles.css"));
await cp(resolve(root, "editor/restyle-theme.css"), resolve(dist, "editor/restyle-theme.css"));
await cp(resolve(root, "packages/pvo-sdk/index.js"), resolve(dist, "packages/pvo-sdk/index.js"));
await cp(resolve(root, "share/assets/demo.pvo"), resolve(dist, "demo.pvo"));
await cp(resolve(root, "share/assets/preview.mp4"), resolve(dist, "preview.mp4"));
await cp(resolve(root, "share/assets/og.png"), resolve(dist, "og.png"));
