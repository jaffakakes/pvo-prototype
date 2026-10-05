import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Compile a consumer so contract declarations and command discrimination stay checked in CI.
test("saved-task public TypeScript declarations accept supported commands and reject malformed ones", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
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
      "tests/assistant-tasks/types.fixture.ts",
    ],
    { cwd: root, encoding: "utf8", timeout: 30_000, stdio: "pipe" },
  );
});
