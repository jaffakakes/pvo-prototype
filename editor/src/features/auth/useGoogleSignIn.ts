import { useEffect, useRef } from "react";
import { googleAuthorizationUrl } from "../../infrastructure/auth/google";
import {
  closeAuthGate,
  refreshAccountSessionAfterSignIn,
  setAuthConnecting,
  setAuthError,
  useAuthGate,
} from "../../state/auth/authGateStore";

/** Open synchronously for popup blockers, then let Supabase own Google OAuth and PKCE. */
export function useGoogleSignIn() {
  const popup = useRef<Window | null>(null);
  const attempt = useRef(0);
  const connecting = useAuthGate((state) => state.connecting);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        !popup.current ||
        event.source !== popup.current
      )
        return;
      if (
        !event.data ||
        typeof event.data !== "object" ||
        event.data.type !== "pvo:auth:complete"
      )
        return;
      attempt.current++;
      popup.current = null;
      if (event.data.ok !== true) {
        setAuthError("Google sign-in didn't finish. Try again.");
        return;
      }
      void refreshAccountSessionAfterSignIn()
        .then((session) => {
          if (session.user) closeAuthGate();
          else setAuthError("Google sign-in didn't finish. Try again.");
        })
        .catch(() => {});
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!connecting) return;
    const timer = window.setInterval(() => {
      if (!popup.current?.closed) return;
      attempt.current++;
      popup.current = null;
      setAuthError("Google sign-in was closed. Try again.");
    }, 500);
    return () => window.clearInterval(timer);
  }, [connecting]);

  useEffect(
    () => () => {
      attempt.current++;
      if (popup.current && !popup.current.closed) popup.current.close();
    },
    [],
  );

  return () => {
    if (popup.current && !popup.current.closed) {
      popup.current.focus();
      return;
    }
    const { supabaseUrl, supabasePublishableKey } = useAuthGate.getState();
    if (!supabaseUrl || !supabasePublishableKey) {
      setAuthError("Google sign-in is not configured here yet.");
      return;
    }
    const opened = window.open(
      "about:blank",
      "restyle-google-sign-in",
      "popup,width=520,height=680",
    );
    if (!opened) {
      setAuthError(
        "Allow pop-ups for this site, then try Google sign-in again.",
      );
      return;
    }
    const currentAttempt = ++attempt.current;
    popup.current = opened;
    opened.document.title = "Restyle sign-in";
    opened.document.body.textContent = "Opening Google sign-in…";
    setAuthConnecting(true);
    opened.focus();
    void googleAuthorizationUrl(supabaseUrl, supabasePublishableKey)
      .then((url) => {
        if (attempt.current !== currentAttempt || opened.closed) return;
        opened.location.replace(url);
      })
      .catch(() => {
        if (attempt.current !== currentAttempt) return;
        popup.current = null;
        opened.close();
        setAuthError("Google sign-in couldn't start. Try again.");
      });
  };
}
