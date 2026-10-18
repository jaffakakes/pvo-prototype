import { useEffect, useRef, useState } from "react";
import {
  closeAuthGate,
  refreshAccountSession,
  setAuthError,
  signOutAccount,
  useAuthGate,
} from "../../state/auth/authGateStore";
import { signOutClerk } from "../../infrastructure/auth/clerk";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { AccountDisclosure } from "./AccountDisclosure";
import { AuthProviders } from "./AuthProviders";
import { ClerkEmailSignIn } from "./ClerkEmailSignIn";
import { useGoogleSignIn } from "./useGoogleSignIn";
import styles from "./AuthDialog.module.css";

export function AuthDialog() {
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
    clerkAvailable,
    clerkPublishableKey,
    canLinkEmail,
    emailLinked,
    user,
    error,
    connecting,
  } = useAuthGate();
  const [signingOut, setSigningOut] = useState(false);
  const [step, setStep] = useState<"gate" | "signin" | "signup">("gate");
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);
  const [linkedNotice, setLinkedNotice] = useState(false);
  const googleLinkTarget = useRef<string | null>(null);
  const emailOpen = step !== "gate";
  const emailAvailable = clerkAvailable && Boolean(clerkPublishableKey);
  const waiting = phase === "checking" || connecting;
  const beginGoogle = useGoogleSignIn((session) => {
    const targetId = googleLinkTarget.current;
    googleLinkTarget.current = null;
    if (!targetId) {
      closeAuthGate();
      return;
    }
    if (session.user?.id !== targetId) {
      setAuthError(
        "You signed in with a different Google account. Return to the original account and try again.",
      );
      return;
    }
    setLinkTargetId(targetId);
    setStep("signin");
  });
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
    googleLinkTarget.current = null;
    setLinkTargetId(null);
    setSigningOut(true);
    setStep("gate");
    void signOutAccount()
      .then(async () => {
        if (!clerkPublishableKey) return;
        try {
          await signOutClerk(clerkPublishableKey);
        } catch {
          setAuthError(
            "Restyle signed out, but the email session could not be cleared. Try again later.",
          );
        }
      })
      .catch(() => setAuthError("Couldn't sign out. Try again."))
      .finally(() => setSigningOut(false));
  };
  const startEmailLink = () => {
    if (!user || !canLinkEmail) return;
    googleLinkTarget.current = user.id;
    setLinkedNotice(false);
    beginGoogle("link");
  };
  const backFromEmail = () => {
    changeStep("gate");
    setLinkTargetId(null);
  };
  useEffect(() => {
    if (!emailOpen || !linkTargetId || user?.id === linkTargetId) return;
    backFromEmail();
    setAuthError(
      "Your Restyle account changed. Sign in with the original Google account and try again.",
    );
  }, [emailOpen, linkTargetId, user?.id]);
  const title = user
    ? "Your account"
    : step === "signup"
      ? "Create account"
      : step === "signin"
        ? "Welcome back"
        : "Ready to export";
  const description =
    step === "signup"
      ? "Your edit stays saved in this browser while you create your account."
      : "Sign in to keep editing your reels.";

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      role="dialog"
      aria-labelledby="auth-title"
      aria-describedby={user || emailOpen ? "auth-description" : undefined}
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
          emailOpen && (
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
        {emailOpen && !linkTargetId && clerkPublishableKey && (
          <ClerkEmailSignIn
            key={step}
            publishableKey={clerkPublishableKey}
            mode="signin"
            standalone
            initialStep={step}
            onBack={backFromEmail}
          />
        )}
        {user && emailLinked && !emailOpen && (
          <p className={styles.availability}>
            {linkedNotice
              ? "Email sign-in connected. You can now use Google or this email for this Restyle account."
              : "Email sign-in is connected to this Restyle account."}
          </p>
        )}
        {user && canLinkEmail && !emailOpen && (
          <p className={styles.availability}>
            Connect a verified email and password to this Google account to keep
            the same published links.
          </p>
        )}
        {user && emailOpen && (
          <p className={styles.availability}>
            Review the exact email account before connecting it. Your Google
            sign-in was refreshed for this step.
          </p>
        )}
        {user && emailOpen && linkTargetId && clerkPublishableKey && (
          <ClerkEmailSignIn
            publishableKey={clerkPublishableKey}
            mode="link"
            expectedUserId={linkTargetId}
            onBack={backFromEmail}
            onLinked={() => {
              backFromEmail();
              setLinkedNotice(true);
            }}
          />
        )}
        {!user && phase === "checking" && (
          <p className={styles.status} role="status">
            Checking your account…
          </p>
        )}
        {!user && phase === "ready" && !available && !clerkAvailable && (
          <p className={styles.availability}>
            Sign-in isn't configured here yet. Your edit is saved in this
            browser.
          </p>
        )}
        {!user && phase === "ready" && available && !clerkAvailable && (
          <p className={styles.status}>
            Email sign-in isn't configured here yet.
          </p>
        )}
        {!user && <AccountDisclosure className={styles.disclosure} />}
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
            {canLinkEmail && !emailOpen && (
              <button
                type="button"
                className={`${styles.secondary} ${styles.email}`}
                disabled={connecting || signingOut}
                onClick={startEmailLink}
              >
                {connecting ? "Waiting for Google…" : "Connect email sign-in"}
              </button>
            )}
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
