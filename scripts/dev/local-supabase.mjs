import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  supabaseProjectUrl,
  supabasePublicKey,
} from "../../server/auth/supabase.js";

/** Public project metadata lives alongside the beta's private local configuration. */
export async function loadLocalSupabase(directory, publishableKey, url) {
  let settings;
  if (publishableKey !== undefined || url !== undefined) {
    settings = { publishableKey, url };
  } else {
    const path = join(directory, "supabase.json");
    let source;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    // Node's Windows mode bits cannot establish owner-only access to this file.
    if (process.platform === "win32")
      throw new Error(
        "On Windows, set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY instead of supabase.json.",
      );
    const details = await stat(path);
    if (!details.isFile() || details.mode & 0o077)
      throw new Error(
        "The local Supabase configuration must be a private mode-0600 file.",
      );
    try {
      settings = JSON.parse(source);
    } catch {
      throw new Error("The local Supabase configuration is not valid JSON.");
    }
  }
  if (
    !supabasePublicKey(settings?.publishableKey) ||
    !supabaseProjectUrl(settings?.url)
  )
    throw new Error(
      "Local Supabase sign-in needs a publishable key and HTTPS project URL.",
    );
  return settings;
}
