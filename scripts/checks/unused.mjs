import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeEntryGraph } from "./helpers/entry-graph.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const policy = JSON.parse(
  await readFile(new URL("./unused-roots.json", import.meta.url), "utf8"),
);
const result = await analyzeEntryGraph(root, policy);
console.log(
  `Entry points: ${result.runtimeModules} runtime modules, ${result.toolOnly.length} used only by tools/fixtures.`,
);
if (result.disconnected.length) {
  console.error(
    "Disconnected source modules:\n" + result.disconnected.join("\n"),
  );
  console.error(
    "Trace their callers before deleting; intentional manual entries need a documented root.",
  );
  process.exitCode = 1;
} else console.log("Entry-point-aware source reachability passed.");
