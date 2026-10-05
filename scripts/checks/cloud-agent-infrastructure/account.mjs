import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const wrangler = fileURLToPath(
  new URL("../../../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

// Keep Wrangler's credential output inside this process, never in a report or log.
export async function readCloudflareToken(environment = process.env) {
  if (environment.CLOUDFLARE_API_TOKEN?.trim()) {
    return environment.CLOUDFLARE_API_TOKEN.trim();
  }
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [wrangler, "auth", "token", "--json"],
      {
        env: { ...environment, WRANGLER_SEND_METRICS: "false" },
        timeout: 30_000,
        maxBuffer: 64 * 1024,
      },
    );
    const credentials = JSON.parse(stdout);
    if (typeof credentials.token === "string" && credentials.token.trim())
      return credentials.token;
  } catch {
    // Child-process errors include stdout/stderr and may contain credentials.
  }
  throw new Error(
    "Cloudflare credentials unavailable. Run wrangler login or supply CLOUDFLARE_API_TOKEN privately.",
  );
}

export function createAccountReader({ accountId, token, fetchImpl = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(accountId))
    throw new Error("Expected a Cloudflare account ID.");
  if (typeof token !== "string" || !token.trim())
    throw new Error("Cloudflare token is required.");

  return async function read(path) {
    try {
      const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body = await response.json();
      return {
        ok: response.ok && body.success === true,
        status: response.status,
        // Use codes for diagnostics; never copy arbitrary provider error text.
        codes: Array.isArray(body.errors)
          ? body.errors.map((error) => error.code).filter(Number.isInteger)
          : [],
        result: response.ok && body.success === true ? body.result : undefined,
      };
    } catch {
      return { ok: false, status: null, codes: [] };
    }
  };
}
