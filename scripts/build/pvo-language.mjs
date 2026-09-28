import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = ["build", "packages/pvo-language", "--target", "web", "--release", "--out-dir", "pkg"];

await new Promise((resolve, reject) => {
  const child = spawn("wasm-pack", args, { cwd: root, stdio: "inherit" });
  child.once("error", (error) => {
    reject(new Error("Could not start wasm-pack. Install wasm-pack to build the PVO language.", { cause: error }));
  });
  child.once("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`PVO language build failed (${signal || `exit ${code}`}).`));
  });
});
