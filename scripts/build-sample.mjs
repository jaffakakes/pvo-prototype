import { readFile, writeFile } from "node:fs/promises";
import { packPvo } from "../packages/pvo-sdk/index.js";

const root = new URL("../", import.meta.url);
const video = await readFile(new URL("assets/pvo-demo.mp4", root));
const manifest = JSON.parse(await readFile(new URL("examples/branching-demo.pvo.json", root), "utf8"));
const packed = await packPvo(video, manifest);
await writeFile(new URL("examples/signal-path.pvo.mp4", root), new Uint8Array(await packed.arrayBuffer()));
console.log(`Wrote examples/signal-path.pvo.mp4 (${packed.size} bytes)`);
