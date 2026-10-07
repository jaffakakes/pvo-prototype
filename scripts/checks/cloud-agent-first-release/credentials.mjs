import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** Read the CLI's single-line API-key setting without logging private configuration. */
export function configuredRunpodKey(config) {
  const match =
    /^\s*apikey\s*=\s*(?:"([^"\\\r\n]*)"|'([^'\r\n]*)')\s*(?:#.*)?$/m.exec(
      config,
    );
  const value = (match?.[1] ?? match?.[2] ?? "").trim();
  return value || null;
}

export async function readRunpodKey({
  environment = process.env,
  configPath = resolve(homedir(), ".runpod/config.toml"),
} = {}) {
  if (environment.RUNPOD_API_KEY?.trim())
    return environment.RUNPOD_API_KEY.trim();
  try {
    const key = configuredRunpodKey(await readFile(configPath, "utf8"));
    if (key) return key;
  } catch {
    /* Missing/unreadable configuration never exposes file contents. */
  }
  throw new Error(
    "Runpod API key is missing. Configure it privately before the live test; no resources have been created.",
  );
}
