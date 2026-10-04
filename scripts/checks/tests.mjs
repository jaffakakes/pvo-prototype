import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
async function testFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await testFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".test.mjs"))
      files.push(path);
  }
  return files;
}
const files = (await testFiles(resolve(root, "tests"))).sort();
if (!files.length) throw new Error("No Node behavior tests were discovered.");
const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=4", ...process.argv.slice(2), ...files],
  {
    cwd: root,
    stdio: "inherit",
  },
);
child.on("error", (error) => {
  console.error("Could not start Node behavior tests:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
