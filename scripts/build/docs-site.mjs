import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(root, "docs-dist");
if (dirname(output) !== resolve(root)) throw new Error("Documentation output must stay inside the repository.");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "docs/site"), resolve(output, "docs"), { recursive: true });
console.log("PVO documentation built separately in docs-dist/docs/.");
