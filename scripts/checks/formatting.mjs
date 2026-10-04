import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check, format, resolveConfig } from "prettier";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scope = JSON.parse(
  await readFile(new URL("./formatting-scope.json", import.meta.url), "utf8"),
);
const write = process.argv.includes("--write");
const failures = [];

// Adopt formatting as files are maintained, without rewriting untouched code.
for (const relative of scope) {
  const filepath = resolve(root, relative);
  const source = await readFile(filepath, "utf8");
  const options = { ...(await resolveConfig(filepath)), filepath };
  if (write) {
    const formatted = await format(source, options);
    if (formatted !== source) await writeFile(filepath, formatted);
  } else if (!(await check(source, options))) failures.push(relative);
}
if (failures.length) {
  console.error(`Run npm run format for:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    `Formatting: ${scope.length} adopted files ${write ? "formatted" : "passed"}.`,
  );
}
