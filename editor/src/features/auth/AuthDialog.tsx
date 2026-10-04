import { useEffect, useRef, useState } from "react";
import {
  closeAuthGate,
  refreshAccountSession,
  setAuthError,
  signOutAccount,
  useAuthGate,
} from "../../state/auth/authGateStore";
import { signOutClerk } from "../../infrastructure/auth/clerk";
import { Icon } from "../../ui/Icon";
import { ClerkEmailSignIn } from "./ClerkEmailSignIn";
import { useGoogleSignIn } from "./useGoogleSignIn";
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
  const { source, phase, available, clerkAvailable, clerkPublishableKey, canLinkEmail, emailLinked,
    user, error, connecting } = useAuthGate();
  const [signingOut, setSigningOut] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);
  const [linkedNotice, setLinkedNotice] = useState(false);
  const googleLinkTarget = useRef<string | null>(null);
  const beginGoogle = useGoogleSignIn(session => {
    const targetId = googleLinkTarget.current;
    googleLinkTarget.current = null;
    if (!targetId) { closeAuthGate(); return; }
    if (session.user?.id !== targetId) {
      setAuthError("You signed in with a different Google account. Return to the original account and try again.");
      return;
    }
    setLinkTargetId(targetId);
    setEmailOpen(true);
  });
  useEffect(() => {
    const focus = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (dialog.current?.open) dialog.current.close();
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);
  const signOut = () => {
    googleLinkTarget.current = null;
    setSigningOut(true);
    void signOutAccount().then(async () => {
      if (!clerkPublishableKey) return;
      try { await signOutClerk(clerkPublishableKey); }
      catch { setAuthError("Restyle signed out, but the email session could not be cleared. Try again later."); }
    }).catch(() => setAuthError("Couldn't sign out. Try again.")).finally(() => setSigningOut(false));
  };
  const startEmailLink = () => {
    if (!user || !canLinkEmail) return;
    googleLinkTarget.current = user.id;
    setLinkedNotice(false);
    beginGoogle("link");
  };
  const backFromEmail = () => {
    setEmailOpen(false);
    setLinkTargetId(null);
  };
  useEffect(() => {
    if (!emailOpen || !linkTargetId || user?.id === linkTargetId) return;
    backFromEmail();
    setAuthError("Your Restyle account changed. Sign in with the original Google account and try again.");
  }, [emailOpen, linkTargetId, user?.id]);
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
      {user && emailLinked && !emailOpen && <p className={styles.availability}>
        {linkedNotice ? "Email sign-in connected. You can now use Google or this email for this Restyle account."
          : "Email sign-in is connected to this Restyle account."}</p>}
      {user && canLinkEmail && !emailOpen && <p className={styles.availability}>
        Connect a verified email and password to this Google account to keep the same published links.</p>}
      {user && emailOpen && <p className={styles.availability}>
        Review the exact email account before connecting it. Your Google sign-in was refreshed for this step.</p>}
      {!user && phase === "checking" && <p role="status">Checking your account…</p>}
      {!user && phase === "ready" && !available && !clerkAvailable && <p className={styles.availability}>Sign-in isn't configured here yet. Editing remains available.</p>}
      {!user && phase === "ready" && available && !clerkAvailable && <p className={styles.availability}>Email sign-in isn't configured here yet.</p>}
      {!user && <p className={styles.disclosure}>Google shares your name and account identifier with Restyle. Clerk handles email addresses, passwords, and verification; Restyle receives a Clerk account identifier. If you already use Google, connect email from Your account first to keep your published links together. Read our <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>.</p>}
      {!user && emailOpen && !linkTargetId && clerkPublishableKey && <ClerkEmailSignIn publishableKey={clerkPublishableKey}
        mode="signin" onBack={backFromEmail} />}
      {user && emailOpen && linkTargetId && clerkPublishableKey && <ClerkEmailSignIn
        publishableKey={clerkPublishableKey} mode="link" expectedUserId={linkTargetId}
        onBack={backFromEmail} onLinked={() => {
          backFromEmail();
          setLinkedNotice(true);
        }} />}
      {error && !emailOpen && <p className={styles.error} role="alert">{error}</p>}
    </div>
    <footer className={styles.footer}>
      {user ? <>
          {canLinkEmail && !emailOpen && <button type="button" className={styles.email}
            disabled={connecting || signingOut} onClick={startEmailLink}>
            {connecting ? "Waiting for Google…" : "Connect email sign-in"}
          </button>}
          {!emailOpen && <button type="button" disabled={signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out"}</button>}
        </>
        : <>
          {phase === "error" && <button type="button" onClick={() => { void refreshAccountSession().catch(() => {}); }}>Retry</button>}
          {!emailOpen && <><button type="button" className={styles.google} disabled={!available || connecting || phase === "checking"} onClick={() => beginGoogle()}>
            {connecting ? "Waiting for Google…" : "Continue with Google"}
          </button>
          <button type="button" className={styles.email} disabled={!clerkAvailable || !clerkPublishableKey || connecting || phase === "checking"}
            onClick={() => setEmailOpen(true)}>Continue with email</button></>}
        </>}
      <button type="button" onClick={closeAuthGate}>{user ? "Done" : "Keep editing"}</button>
    </footer>
  </dialog>;
}
