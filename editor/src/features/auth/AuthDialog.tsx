import { useEffect, useRef, useState } from "react";
import {
  closeAuthGate,
  refreshAccountSession,
  setAuthError,
  useAuthGate,
} from "../../state/auth/authGateStore";
import { signOutCurrentAccount } from "../../state/auth/accountCommands";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { AccountDisclosure } from "./AccountDisclosure";
import { AuthProviders } from "./AuthProviders";
import { SupabaseEmailSignIn } from "./SupabaseEmailSignIn";
import { useEmailCallback } from "./useEmailCallback";
import { useGoogleSignIn } from "./useGoogleSignIn";
import styles from "./AuthDialog.module.css";

export function AuthDialog() {
  useEmailCallback();
  const source = useAuthGate((state) => state.source);
  const exportSheetOpen = useCapture((state) => state.sheet === "export");
  useEffect(() => {
    const refresh = () => {
      void refreshAccountSession().catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return source && !(source === "export" && exportSheetOpen) ? (
    <OpenAuthDialog />
  ) : null;
}

function OpenAuthDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const {
    phase,
    available,
    source,
    supabaseAvailable,
    supabasePublishableKey,
    supabaseUrl,
    user,
    error,
    connecting,
  } = useAuthGate();
  const [signingOut, setSigningOut] = useState(false);
  const [step, setStep] = useState<"gate" | "signin" | "signup">(source === "recovery" ? "signin" : "gate");
  const emailOpen = step !== "gate";
  const emailAvailable = supabaseAvailable && Boolean(supabasePublishableKey);
  const waiting = phase === "checking" || connecting;
  const beginGoogle = useGoogleSignIn();
  useEffect(() => {
    const focus = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (dialog.current?.open) dialog.current.close();
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);
  useEffect(() => {
    if (step !== "gate") heading.current?.focus();
  }, [step]);
  const changeStep = (next: typeof step) => {
    useAuthGate.setState({ error: null });
    setStep(next);
  };
  const signOut = () => {
    setSigningOut(true);
    setStep("gate");
    void signOutCurrentAccount()
      .catch((error) =>
        setAuthError(
          error instanceof Error
            ? error.message
            : "Couldn't sign out. Try again.",
        ),
      )
      .finally(() => setSigningOut(false));
  };
  const backFromEmail = () => changeStep("gate");
  const title = source === "recovery" ? "Reset password" : user
    ? "Your account"
    : step === "signup"
      ? "Create account"
      : step === "signin"
        ? "Welcome back"
        : "Ready to export";
  const description =
    source === "recovery" ? "Choose a new password for your email account." : step === "signup"
      ? "Your edit stays saved in this browser while you create your account."
      : null;

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      role="dialog"
      aria-labelledby="auth-title"
      aria-describedby={
        user || (emailOpen && description) ? "auth-description" : undefined
      }
      data-auth-step={user ? "account" : step}
      onCancel={(event) => {
        event.preventDefault();
        closeAuthGate();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeAuthGate();
      }}
    >
      <header className={styles.heading}>
        {!user && emailOpen && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => changeStep("gate")}
            aria-label="Back to sign-in options"
          >
            <Icon name="back" size={18} />
          </button>
        )}
        <h2 ref={heading} id="auth-title" tabIndex={-1}>
          {title}
        </h2>
        <button
          type="button"
          className={styles.iconButton}
          onClick={closeAuthGate}
          aria-label="Close sign in"
        >
          <Icon name="close" size={15} />
        </button>
      </header>
      <div className={styles.content}>
        {user ? (
          <p id="auth-description" className={styles.availability}>
            Signed in as <strong>{user.name}</strong>. Your current edit is
            saved in this browser.
          </p>
        ) : (
          emailOpen &&
          description && (
            <p id="auth-description" className={styles.description}>
              {description}
            </p>
          )
        )}
        {!user && !emailOpen && (
          <AuthProviders
            googleDisabled={!available || waiting}
            emailDisabled={!emailAvailable || waiting}
            connecting={connecting}
            onGoogle={() => beginGoogle()}
            onEmail={() => changeStep("signup")}
          />
        )}
        {emailOpen && supabasePublishableKey && supabaseUrl && (
          <SupabaseEmailSignIn
            key={step}
            url={supabaseUrl}
            publishableKey={supabasePublishableKey}
            recovery={source === "recovery"}
            standalone
            initialStep={step}
            onBack={backFromEmail}
          />
        )}
        {!user && phase === "checking" && (
          <p className={styles.status} role="status">
            Checking your account…
          </p>
        )}
        {!user && phase === "ready" && !available && !supabaseAvailable && (
          <p className={styles.availability}>
            Sign-in isn't configured here yet. Your edit is saved in this
            browser.
          </p>
        )}
        {!user && phase === "ready" && available && !supabaseAvailable && (
          <p className={styles.status}>
            Email sign-in isn't configured here yet.
          </p>
        )}
        {!user && !emailOpen && (
          <AccountDisclosure className={styles.disclosure} />
        )}
        {error && !emailOpen && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!user && phase === "error" && (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              void refreshAccountSession().catch(() => {});
            }}
          >
            Retry account check
          </button>
        )}
      </div>
      <footer className={styles.footer}>
        {user ? (
          <>
            {!emailOpen && (
              <button
                type="button"
                className={styles.secondary}
                disabled={signingOut}
                onClick={signOut}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            )}
            <button
              type="button"
              className={styles.secondary}
              onClick={closeAuthGate}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <p className={styles.swap}>
              {step === "signin" ? "New here?" : "Already have an account?"}{" "}
              <button
                type="button"
                disabled={!emailAvailable || waiting}
                onClick={() =>
                  changeStep(step === "signin" ? "signup" : "signin")
                }
              >
                {step === "signin" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </>
        )}
      </footer>
    </dialog>
  );
}
