import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("public service declarations support a consumer and reject unsupported contracts", () => {
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
      "tests/service-packages/types.fixture.ts",
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
      stdio: "pipe",
    },
  );
});
