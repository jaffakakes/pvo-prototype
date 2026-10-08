import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

// Human entry only. The key never appears in chat, command arguments or process output.
if (process.platform !== "darwin")
  throw new Error("Set RUNPOD_API_KEY privately on this platform.");
const exec = promisify(execFile);
let entered;
try {
  const result = await exec(
    "/usr/bin/osascript",
    [
      "-e",
      `
    set entered to display dialog "Paste your Runpod API key for Restyle's approved live test. It will be saved privately in your local Runpod settings." default answer "" with hidden answer buttons {"Cancel", "Save key"} default button "Save key" with title "Restyle test: Runpod access"
    return text returned of entered
  `,
    ],
    { timeout: 600000, maxBuffer: 16384 },
  );
  entered = result.stdout.trim();
} catch {
  console.error(
    "Key entry was cancelled or could not finish. Nothing was saved.",
  );
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{20,4096}$/.test(entered)) {
  console.error("That does not look like a Runpod API key. Nothing was saved.");
  process.exit(1);
}
const directory = resolve(homedir(), ".runpod");
const target = resolve(directory, "config.toml");
let config = "";
try {
  config = await readFile(target, "utf8");
} catch (error) {
  if (error.code !== "ENOENT")
    throw new Error("Could not read local Runpod settings.");
}
const setting = `apikey = ${JSON.stringify(entered)}`;
config = /^\s*apikey\s*=.*$/m.test(config)
  ? config.replace(/^\s*apikey\s*=.*$/m, setting)
  : `${config.trimEnd()}\n${setting}\n`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const temporary = resolve(directory, `config-${process.pid}.tmp`);
try {
  await writeFile(temporary, config, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
} finally {
  await rm(temporary, { force: true });
}
console.log(
  "Runpod key saved privately. No model request or cloud deployment was made.",
);
