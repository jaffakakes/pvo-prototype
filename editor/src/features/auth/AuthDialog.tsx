import { useEffect, useRef, useState } from "react";
import { googleSignInUrl } from "../../infrastructure/auth/client";
import {
  closeAuthGate,
  refreshAccountSession,
  setAuthConnecting,
  setAuthError,
  signOutAccount,
  useAuthGate,
} from "../../state/auth/authGateStore";
import { Icon } from "../../ui/Icon";
import styles from "./AuthDialog.module.css";

export function AuthDialog() {
  const source = useAuthGate(state => state.source);
  useEffect(() => {
    const refresh = () => { void refreshAccountSession().catch(() => {}); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return source ? <OpenAuthDialog /> : null;
}

function OpenAuthDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const popup = useRef<Window | null>(null);
  const { source, phase, available, user, error, connecting } = useAuthGate();
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    const focus = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (dialog.current?.open) dialog.current.close();
      if (popup.current && !popup.current.closed) popup.current.close();
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== popup.current) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.type !== "pvo:auth:complete") return;
      popup.current = null;
      if (data.ok !== true) {
        setAuthError("Google sign-in didn't finish. Try again.");
        return;
      }
      void refreshAccountSession().then(session => {
        if (session.user) closeAuthGate();
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
      void refreshAccountSession().then(session => {
        if (session.user) closeAuthGate();
        else setAuthError("Google sign-in was closed. Try again.");
      }).catch(() => {});
    }, 500);
    return () => window.clearInterval(timer);
  }, [connecting]);

  const beginGoogle = () => {
    const opened = window.open(googleSignInUrl(), "restyle-google-sign-in", "popup,width=520,height=680");
    if (!opened) {
      setAuthError("Allow pop-ups for this site, then try Google sign-in again.");
      return;
    }
    popup.current = opened;
    setAuthConnecting(true);
    opened.focus();
  };
  const signOut = () => {
    setSigningOut(true);
    void signOutAccount().catch(() => setAuthError("Couldn't sign out. Try again.")).finally(() => setSigningOut(false));
  };
  const description = source === "export" ? "Sign in to export this project. Your edit and export settings will stay here."
    : source === "download" ? "Sign in to download this export. Your finished file will stay here."
      : source === "share" ? "Sign in to share this export. Your finished file will stay here."
        : source === "replies" ? "Sign in to collect and read replies from your videos. Your current edit will stay here."
        : "Sign in to export and manage your videos. Your projects stay saved in this browser.";

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="auth-title" aria-describedby="auth-description"
    onCancel={event => { event.preventDefault(); closeAuthGate(); }}
    onClick={event => { if (event.target === event.currentTarget) closeAuthGate(); }}>
    <div className={styles.content}>
      <div className={styles.heading}><h2 id="auth-title">{user ? "Your account" : "Sign in to Restyle"}</h2>
        <button type="button" className={styles.close} onClick={closeAuthGate} aria-label="Close sign in"><Icon name="close" size={19} /></button>
      </div>
      {user ? <p id="auth-description" className={styles.availability}>Signed in as <strong>{user.name}</strong>. Your current edit is saved in this browser.</p>
        : <p id="auth-description">{description}</p>}
      {!user && phase === "checking" && <p role="status">Checking your account…</p>}
      {!user && phase === "ready" && !available && <p className={styles.availability}>Google sign-in isn't configured for this beta yet. Editing remains available.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!user && <p className={styles.disclosure}>Google shares your name and account identifier with Restyle for sign-in and exports. Read our <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>.</p>}
    </div>
    <footer className={styles.footer}>
      {user ? <button type="button" disabled={signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
        : <>
          {phase === "error" && <button type="button" onClick={() => { void refreshAccountSession().catch(() => {}); }}>Retry</button>}
          <button type="button" className={styles.google} disabled={!available || connecting || phase === "checking"} onClick={beginGoogle}>
            {connecting ? "Waiting for Google…" : "Continue with Google"}
          </button>
        </>}
      <button type="button" onClick={closeAuthGate}>{user ? "Done" : "Keep editing"}</button>
    </footer>
  </dialog>;
}
