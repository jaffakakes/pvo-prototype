import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { sandboxFlags, sandboxSpec } from "./sandbox.mjs";

// Trusted Machine init. The controller still owns the outside lease and whole-Machine deletion.
await mkdir("/control/bundle", { recursive: true, mode: 0o700 });
await writeFile("/control/bundle/config.json", JSON.stringify(sandboxSpec), {
  mode: 0o600,
  flag: "wx",
});
const child = spawn(
  "/opt/gvisor/runsc",
  [...sandboxFlags, "run", "--bundle=/control/bundle", "service"],
  { stdio: "ignore", env: { PATH: "/usr/local/bin:/usr/bin:/bin" } },
);
child.once("error", () => process.exit(1));
child.once("exit", (code) => process.exit(code === 0 ? 0 : 1));
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill("SIGKILL"));
