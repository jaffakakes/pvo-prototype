import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("workspace declarations keep commands and lifecycle state typed at the public boundary", () => {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "--noEmit",
      "--strict",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--target",
      "es2022",
      "tests/assistant-workspaces/types.fixture.ts",
      "tests/assistant-builder/types.fixture.ts",
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
      stdio: "pipe",
    },
  );
});
