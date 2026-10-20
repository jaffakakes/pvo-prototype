import { useEffect } from "react";
import { getAccountSession } from "../../infrastructure/auth/client";
import { getSupabase } from "../../infrastructure/auth/supabase";
import { openSignIn, setAuthError } from "../../state/auth/authGateStore";

/** Consume PKCE links only on the dedicated email return path; never exchange a lingering session implicitly. */
export function useEmailCallback() {
  useEffect(() => {
    const url = new URL(location.href);
    const purpose = url.searchParams.get("auth");
    if (purpose !== "confirm" && purpose !== "recovery") return;
    const code = url.searchParams.get("code");
    url.searchParams.delete("auth");
    url.searchParams.delete("code");
    url.searchParams.delete("error");
    url.searchParams.delete("error_code");
    url.searchParams.delete("error_description");
    history.replaceState(history.state, "", url.pathname + url.search);
    void (async () => {
      try {
        const config = await getAccountSession();
        if (!code || !config.supabaseUrl || !config.supabasePublishableKey)
          throw new Error();
        const provider = await getSupabase(
          config.supabaseUrl,
          config.supabasePublishableKey,
        );
        const { data, error } =
          await provider.auth.exchangeCodeForSession(code);
        if (error || !data.session) throw new Error();
        openSignIn(purpose === "recovery" ? "recovery" : "signin");
      } catch {
        openSignIn();
        setAuthError(
          "This email link couldn't be opened. Request another link and open it in the same browser.",
        );
      }
    })();
  }, []);
}
