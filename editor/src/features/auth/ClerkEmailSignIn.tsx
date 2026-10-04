import { useEffect, useRef, useState } from "react";
import type { Clerk } from "@clerk/clerk-js";
import { exchangeClerkSession, getAccountSession, linkClerkSession } from "../../infrastructure/auth/client";
import { getClerk } from "../../infrastructure/auth/clerk";
import { closeAuthGate, refreshAccountSessionAfterSignIn, setAuthError, useAuthGate } from "../../state/auth/authGateStore";
import styles from "./ClerkEmailSignIn.module.css";

type ClerkSession = NonNullable<Clerk["session"]>;
type Props = {
  publishableKey: string;
  onBack(): void;
  mode: "signin" | "link";
  expectedUserId?: string;
  onLinked?(): void;
};
type Review = { email: string; clerkUserId: string };

/** The prebuilt Clerk form owns passwords, verification, and recovery. Linking requires a separate account review. */
export function ClerkEmailSignIn({ publishableKey, onBack, mode, expectedUserId, onLinked }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const clerkRef = useRef<Clerk | null>(null);
  const pendingSession = useRef<ClerkSession | null>(null);
  const existingSessionRequiresConfirmation = useRef(false);
  const completeSignIn = useRef<((session: ClerkSession) => Promise<void>) | null>(null);
  const active = useRef(true);
  const linking = useRef(false);
  const [status, setStatus] = useState<"loading" | "form" | "review" | "exchange" | "retry">("loading");
  const [review, setReview] = useState<Review | null>(null);
  const [attempt, setAttempt] = useState(0);
  const error = useAuthGate(state => state.error);

  useEffect(() => {
    active.current = true;
    let effectActive = true;
    let mounted = false;
    let exchanging = false;
    let unsubscribe: (() => void) | null = null;
    const redirectUrl = location.href;

    const signIn = async (session: ClerkSession) => {
      if (!effectActive || exchanging) return;
      exchanging = true;
      setStatus("exchange");
      try {
        const token = await session.getToken();
        if (!token) throw new Error("Your email session could not be verified. Try again.");
        await exchangeClerkSession(token);
        const account = await refreshAccountSessionAfterSignIn();
        if (!account.user) throw new Error("Your Restyle account could not be opened. Try again.");
        if (effectActive) closeAuthGate();
      } catch (reason) {
        if (effectActive) {
          setStatus("retry");
          setAuthError(reason instanceof Error ? reason.message : "Couldn't finish email sign-in. Try again.");
        }
      } finally {
        exchanging = false;
      }
    };
    completeSignIn.current = signIn;

    const presentAccount = (session: ClerkSession, user: Clerk["user"]) => {
      if (!effectActive || linking.current) return;
      const address = user?.primaryEmailAddress;
      if (!address || address.verification.status !== "verified") {
        setStatus("retry");
        setAuthError("This Clerk account needs a verified email address before it can be connected.");
        return;
      }
      pendingSession.current = session;
      setReview({ email: address.emailAddress, clerkUserId: user.id });
      setStatus("review");
    };

    void getClerk(publishableKey).then(clerk => {
      if (!effectActive || !host.current) return;
      clerkRef.current = clerk;
      existingSessionRequiresConfirmation.current = Boolean(clerk.session);
      unsubscribe = clerk.addListener(({ session, user }) => {
        if (!session) return;
        if (mode === "link" || existingSessionRequiresConfirmation.current)
          presentAccount(session, user ?? clerk.user);
        else void signIn(session);
      });
      if (clerk.session) {
        presentAccount(clerk.session, clerk.user);
        return;
      }
      clerk.mountSignIn(host.current, {
        routing: "hash",
        forceRedirectUrl: redirectUrl,
        signUpForceRedirectUrl: redirectUrl,
      });
      mounted = true;
      setStatus("form");
    }).catch(() => {
      if (!effectActive) return;
      setStatus("retry");
      setAuthError("Email sign-in couldn't load. Check your connection and try again.");
    });
    return () => {
      effectActive = false;
      active.current = false;
      unsubscribe?.();
      if (mounted && host.current && clerkRef.current) clerkRef.current.unmountSignIn(host.current);
      clerkRef.current = null;
      pendingSession.current = null;
      completeSignIn.current = null;
    };
  }, [publishableKey, attempt, mode]);

  const confirmAccount = async () => {
    const candidate = pendingSession.current;
    const clerk = clerkRef.current;
    if (!candidate || !clerk || !review || linking.current) return;
    linking.current = true;
    setStatus("exchange");
    try {
      const address = clerk.user?.primaryEmailAddress;
      if (clerk.session?.id !== candidate.id || clerk.user?.id !== review.clerkUserId
        || !address || address.emailAddress !== review.email || address.verification.status !== "verified")
        throw new Error("The email account changed. Review it again before connecting.");
      if (mode === "signin") {
        existingSessionRequiresConfirmation.current = false;
        if (!completeSignIn.current) throw new Error("Email sign-in is unavailable. Try again.");
        await completeSignIn.current(candidate);
        return;
      }
      if (!expectedUserId) throw new Error("Choose the Google account to connect before continuing.");
      const account = await getAccountSession();
      if (account.user?.id !== expectedUserId || !account.canLinkEmail)
        throw new Error("Your Restyle account changed. Sign in with the original Google account and try again.");
      const token = await candidate.getToken();
      if (!token) throw new Error("Your email session could not be verified. Try again.");
      await linkClerkSession(token, expectedUserId);
      const linked = await refreshAccountSessionAfterSignIn();
      if (linked.user?.id !== expectedUserId || !linked.emailLinked)
        throw new Error("The email account connection could not be confirmed. Try again.");
      if (active.current) onLinked?.();
    } catch (reason) {
      if (active.current) {
        setStatus("retry");
        setAuthError(reason instanceof Error ? reason.message : "Couldn't connect email sign-in. Try again.");
      }
    } finally {
      linking.current = false;
    }
  };

  const useAnotherEmail = async () => {
    const clerk = clerkRef.current;
    if (!clerk) return;
    setStatus("loading");
    pendingSession.current = null;
    setReview(null);
    try {
      await clerk.signOut(() => {});
      if (!active.current) return;
      existingSessionRequiresConfirmation.current = false;
      setAttempt(value => value + 1);
    } catch {
      if (active.current) {
        setStatus("retry");
        setAuthError("Couldn't switch email accounts. Try again.");
      }
    }
  };

  const retry = () => {
    pendingSession.current = null;
    setReview(null);
    setStatus("loading");
    setAttempt(value => value + 1);
  };

  return <div className={styles.email} data-clerk-email-sign-in>
    <button type="button" className={styles.back} onClick={onBack}>
      {mode === "link" ? "← Back to your account" : "← Back to sign-in options"}
    </button>
    {(status === "loading" || status === "exchange") && <p role="status" className={styles.status}>
      {status === "loading" ? "Opening email sign-in…" : mode === "link" ? "Connecting email sign-in…" : "Finishing sign-in…"}</p>}
    {status === "review" && review && <div className={styles.review} data-clerk-account-review>
      <p>{mode === "link" ? "Connect" : "Continue as"} <strong>{review.email}</strong>?</p>
      <p>{mode === "link" ? "Your existing projects and published links will stay with this Restyle account."
        : "This opens or creates the Restyle account for this email."}</p>
      <button type="button" onClick={() => { void confirmAccount(); }}>
        {mode === "link" ? "Connect this email" : `Continue as ${review.email}`}</button>
      <button type="button" className={styles.secondary} onClick={() => { void useAnotherEmail(); }}>Use another email</button>
    </div>}
    {status === "retry" && <div className={styles.retry}>
      <p role="alert">{error || "Email sign-in didn't finish."}</p>
      <button type="button" onClick={retry}>Retry email sign-in</button>
      {clerkRef.current?.session && <button type="button" className={styles.secondary}
        onClick={() => { void useAnotherEmail(); }}>Use another email</button>}
    </div>}
    <div ref={host} className={styles.form} data-visible={status === "form"} />
  </div>;
}
