import { getAccountSession } from "./client";
import { getSupabase } from "./supabase";

/** Private proof belongs to the cookie owner; the server checks its linked Supabase subject. */
export async function accountSessionToken(
  ownerId: string,
  signal: AbortSignal,
) {
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  lifetime.throwIfAborted();
  let cancelled: () => void = () => {};
  const abort = new Promise<never>((_, reject) => {
    cancelled = () =>
      reject(new Error("Account check stopped. Reopen private setup."));
    lifetime.addEventListener("abort", cancelled, { once: true });
  });
  try {
    return await Promise.race([
      abort,
      (async () => {
        const account = await getAccountSession();
        lifetime.throwIfAborted();
        if (account.user?.id !== ownerId)
          throw new Error("Your account changed. Reopen private setup.");
        if (
          !account.supabaseAvailable ||
          !account.supabaseUrl ||
          !account.supabasePublishableKey
        )
          throw new Error(
            "Connect email sign-in before setting up your agent.",
          );
        const supabase = await getSupabase(
          account.supabaseUrl,
          account.supabasePublishableKey,
        ).catch(() => {
          throw new Error("Sign in again before setting up your agent.");
        });
        lifetime.throwIfAborted();
        let token: string | null;
        try {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          token = data.session?.access_token ?? null;
        } catch {
          throw new Error("Sign in again before setting up your agent.");
        }
        lifetime.throwIfAborted();
        if (!token)
          throw new Error("Sign in again before setting up your agent.");
        return token;
      })(),
    ]);
  } finally {
    lifetime.removeEventListener("abort", cancelled);
  }
}
