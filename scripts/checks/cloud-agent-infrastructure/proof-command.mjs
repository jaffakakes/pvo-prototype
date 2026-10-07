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
  const diagnosticFile = resolve(
    directory,
    `${resource.kind}-${args[0]}-${args.includes("--dry-run") ? "dry-run" : "command"}.log`,
  );
  async function record(result) {
    let diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    for (const secret of [token, ...secrets])
      if (typeof secret === "string" && secret)
        diagnostic = diagnostic.replaceAll(secret, "[redacted]");
    await writeFile(diagnosticFile, diagnostic, { mode: 0o600 });
  }
  try {
    const result = await exec(
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
    await record(result);
    return result;
  } catch (error) {
    await record(error);
    throw new Error(
      `Proof command failed; see private diagnostic ${diagnosticFile}`,
    );
  }
}
