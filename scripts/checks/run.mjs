import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const suites = ["editor", "player", "language", "runtime"];
const [suite, ...requested] = process.argv.slice(2);
if (!suites.includes(suite)) {
  throw new Error(`Choose a browser suite: ${suites.join(", ")}. Optionally name checks after the suite.`);
}

const directory = new URL(`./${suite}/`, import.meta.url);
const available = (await readdir(directory)).filter(name => name.endsWith(".mjs")).sort();
const checks = requested.length ? requested.map(name => name.endsWith(".mjs") ? name : `${name}.mjs`) : available;
for (const name of checks) {
  if (!available.includes(name)) throw new Error(`Unknown ${suite} check: ${name}. Available: ${available.join(", ")}`);
}

for (const name of checks) {
  console.log(`Browser check: ${suite}/${name}`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(name, directory))], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${suite}/${name} failed (${signal || `exit ${code}`}).`));
    });
  });
}
