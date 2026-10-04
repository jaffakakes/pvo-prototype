import { useEffect, useRef } from "react";
import { googleSignInUrl, type AccountSession } from "../../infrastructure/auth/client";
import {
  closeAuthGate,
  refreshAccountSessionAfterSignIn,
  setAuthConnecting,
  setAuthError,
  useAuthGate,
} from "../../state/auth/authGateStore";

/** The account dialog and export gate share one popup and session completion flow. */
export function useGoogleSignIn(onComplete?: (session: AccountSession) => void) {
  const popup = useRef<Window | null>(null);
  const purpose = useRef<"signin" | "link">("signin");
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const connecting = useAuthGate(state => state.connecting);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== popup.current) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.type !== "pvo:auth:complete") return;
      popup.current = null;
      if (data.ok !== true) {
        purpose.current = "signin";
        setAuthError("Google sign-in didn't finish. Try again.");
        return;
      }
      void refreshAccountSessionAfterSignIn().then(session => {
        purpose.current = "signin";
        if (session.user) {
          if (onCompleteRef.current) onCompleteRef.current(session);
          else closeAuthGate();
        }
        else setAuthError("Google sign-in didn't finish. Try again.");
      }).catch(() => {});
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!connecting) return;
    const timer = window.setInterval(() => {
      if (!popup.current || !popup.current.closed) return;
      popup.current = null;
      window.clearInterval(timer);
      if (purpose.current === "link") {
        purpose.current = "signin";
        setAuthError("Google sign-in was closed before confirming this account. Try again.");
        return;
      }
      void refreshAccountSessionAfterSignIn().then(session => {
        if (session.user) {
          if (onCompleteRef.current) onCompleteRef.current(session);
          else closeAuthGate();
        }
        else setAuthError("Google sign-in was closed. Try again.");
      }).catch(() => {});
    }, 500);
    return () => window.clearInterval(timer);
  }, [connecting]);

  useEffect(() => () => {
    if (popup.current && !popup.current.closed) popup.current.close();
  }, []);

  const beginGoogle = (nextPurpose: "signin" | "link" = "signin") => {
    const opened = window.open(googleSignInUrl(), "restyle-google-sign-in", "popup,width=520,height=680");
    if (!opened) {
      setAuthError("Allow pop-ups for this site, then try Google sign-in again.");
      return;
    }
    purpose.current = nextPurpose;
    popup.current = opened;
    setAuthConnecting(true);
    opened.focus();
  };

  return beginGoogle;
}
