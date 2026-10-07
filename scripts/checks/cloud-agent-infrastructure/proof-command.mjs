import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";

const exec = promisify(execFile);

/** Credentials stay in the child environment; diagnostics are private and redacted. */
export async function proofCommand(
  resource,
  args,
  { root, directory, token, secrets = [] },
) {
  try {
    return await exec(
      process.execPath,
      [
        resolve(root, "node_modules/wrangler/bin/wrangler.js"),
        ...args,
        "--config",
        resource.config,
      ],
      {
        cwd: root,
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: token,
          WRANGLER_SEND_METRICS: "false",
          CI: "true",
        },
      },
    );
  } catch (error) {
    let diagnostic = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    for (const secret of [token, ...secrets])
      if (typeof secret === "string" && secret)
        diagnostic = diagnostic.replaceAll(secret, "[redacted]");
    const file = resolve(directory, `${resource.kind}-command-error.log`);
    await writeFile(file, diagnostic, { mode: 0o600 });
    throw new Error(`Proof command failed; see private diagnostic ${file}`);
  }
}
