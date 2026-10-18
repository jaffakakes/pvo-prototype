import { useEffect, useState } from "react";
import {
  exchangeSupabaseSession,
  getAccountSession,
} from "../../infrastructure/auth/client";
import { getSupabase } from "../../infrastructure/auth/supabase";

/** A popup callback never starts project autosave, the camera or the editor. */
export function GoogleCallback() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const url = new URL(location.href);
    const code = url.searchParams.get("code");
    history.replaceState(history.state, "", url.pathname + "?auth=google");
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
        await exchangeSupabaseSession(data.session.access_token);
        if (!window.opener) {
          location.replace("/editor/");
          return;
        }
        window.opener.postMessage(
          { type: "pvo:auth:complete", ok: true },
          location.origin,
        );
        window.close();
      } catch {
        if (window.opener)
          window.opener.postMessage(
            { type: "pvo:auth:complete", ok: false },
            location.origin,
          );
        setFailed(true);
      }
    })();
  }, []);
  return (
    <main
      style={{
        padding: "24px",
        fontFamily: "var(--f-ui)",
        color: "var(--text)",
      }}
    >
      <p role={failed ? "alert" : "status"}>
        {failed
          ? "Google sign-in couldn't finish. Return to your video and try again."
          : "Finishing Google sign-in…"}
      </p>
      {failed && <a href="/editor/">Return to Restyle</a>}
    </main>
  );
}
