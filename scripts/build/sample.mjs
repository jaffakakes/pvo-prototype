import { readFile, writeFile } from "node:fs/promises";
import { packPvoProject } from "../../packages/pvo-sdk/index.js";

const root = new URL("../../", import.meta.url);
const video = await readFile(new URL("assets/pvo-demo.mp4", root));
const manifest = JSON.parse(await readFile(new URL("examples/branching-demo.pvo.json", root), "utf8"));
const packed = await packPvoProject({
  manifest,
  assets: [{ id: "demo_media", name: "media/signal-path.mp4", blob: new Blob([video], { type: "video/mp4" }) }],
});
await writeFile(new URL("examples/signal-path.pvo", root), new Uint8Array(await packed.arrayBuffer()));
console.log(`Wrote examples/signal-path.pvo (${packed.size} bytes)`);
