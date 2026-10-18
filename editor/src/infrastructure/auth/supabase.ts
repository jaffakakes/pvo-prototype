import type { SupabaseClient } from "@supabase/supabase-js";

let loaded: { key: string; promise: Promise<SupabaseClient> } | null = null;

export function getSupabase(
  url: string,
  publishableKey: string,
): Promise<SupabaseClient> {
  if (
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ||
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)
  )
    return Promise.reject(
      new Error("Email sign-in is not configured here yet."),
    );
  const key = `${url}:${publishableKey}`;
  if (loaded?.key === key) return loaded.promise;
  const promise = import("@supabase/supabase-js")
    .then(({ createClient }) =>
      createClient(url, publishableKey, {
        global: {
          fetch: (input, options) =>
            fetch(input, {
              ...options,
              signal: AbortSignal.any([
                AbortSignal.timeout(10000),
                ...(options?.signal ? [options.signal] : []),
              ]),
            }),
        },
        auth: {
          flowType: "pkce",
          detectSessionInUrl: false,
          storageKey: `restyle-auth-${new URL(url).hostname.split(".")[0]}`,
        },
      }),
    )
    .catch((error) => {
      if (loaded?.promise === promise) loaded = null;
      throw error;
    });
  loaded = { key, promise };
  return promise;
}

export function emailCallbackUrl(purpose: "confirm" | "recovery"): string {
  const url = new URL("/editor/", location.origin);
  url.searchParams.set("auth", purpose);
  return url.href;
}

export async function signOutSupabase(
  url: string,
  publishableKey: string,
): Promise<void> {
  const client = await getSupabase(url, publishableKey);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new Error("Couldn't clear email sign-in. Try again.");
}
