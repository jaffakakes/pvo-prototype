import { useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { exchangeSupabaseSession } from "../../infrastructure/auth/client";
import {
  emailCallbackUrl,
  getSupabase,
  signOutSupabase,
} from "../../infrastructure/auth/supabase";
import {
  closeAuthGate,
  refreshAccountSessionAfterSignIn,
} from "../../state/auth/authGateStore";

export type EmailSignInOptions = {
  url: string;
  publishableKey: string;
  initialStep?: "signin" | "signup";
  recovery?: boolean;
};
type Step = "signin" | "signup" | "forgot" | "password" | "review";

export function useEmailSignIn(options: EmailSignInOptions) {
  const { url, publishableKey, recovery, initialStep = "signin" } = options;
  const [step, setStep] = useState<Step>(recovery ? "password" : initialStep);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Session | null>(null);
  const client = useRef<SupabaseClient | null>(null);
  const active = useRef(false);
  const running = useRef(false);

  useEffect(() => {
    active.current = true;
    let current = true;
    void getSupabase(url, publishableKey)
      .then(async (provider) => {
        const { data, error: sessionError } = await provider.auth.getSession();
        if (!current) return;
        if (sessionError) throw sessionError;
        client.current = provider;
        if (data.session && !recovery) {
          setCandidate(data.session);
          setStep("review");
        } else if (recovery && !data.session) {
          setStep("forgot");
          setError("This reset link has expired. Request another email.");
        }
      })
      .catch(() => {
        if (current)
          setError(
            "Email sign-in couldn't load. Close this form and try again.",
          );
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
      active.current = false;
    };
  }, [url, publishableKey, recovery]);

  const finish = async (session: Session) => {
    if (!active.current) return;
    await exchangeSupabaseSession(session.access_token);
    const account = await refreshAccountSessionAfterSignIn();
    if (!account.user)
      throw new Error("Couldn't open your Restyle account. Try again.");
    if (active.current) closeAuthGate();
  };

  const run = async (operation: () => Promise<void>) => {
    if (running.current || !client.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
    } catch (reason) {
      if (active.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Sign-in didn't finish. Try again.",
        );
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      const provider = client.current!;
      if (step === "forgot") {
        const { error: failure } = await provider.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: emailCallbackUrl("recovery") },
        );
        if (failure)
          throw new Error(
            "Couldn't send the reset email. Wait a moment and try again.",
          );
        if (active.current)
          setNotice(
            "If an account exists for this email, a reset link is on its way. Open it in this browser.",
          );
        return;
      }
      if (step === "password") {
        const { error: failure } = await provider.auth.updateUser({ password });
        if (failure)
          throw new Error(
            "Couldn't update your password. Use at least 8 characters or request a new reset link.",
          );
        if (!active.current) return;
        setPassword("");
        const { data } = await provider.auth.getSession();
        if (data.session) {
          setCandidate(data.session);
          setStep("review");
        }
        setNotice("Password updated. Continue to your account.");
        return;
      }
      const result =
        step === "signup"
          ? await provider.auth.signUp({
              email: email.trim(),
              password,
              options: { emailRedirectTo: emailCallbackUrl("confirm") },
            })
          : await provider.auth.signInWithPassword({
              email: email.trim(),
              password,
            });
      if (result.error)
        throw new Error(
          step === "signup"
            ? "Couldn't create this account. Use at least 8 characters, or try signing in if you already have an account."
            : "Couldn't sign in. Check your email and password, or reset your password.",
        );
      if (!active.current) return;
      setPassword("");
      if (!result.data.session) {
        setNotice(
          "Check your email for a confirmation link. Open it in this browser, then continue signing in.",
        );
        return;
      }
      setCandidate(result.data.session);
      setStep("review");
      await finish(result.data.session);
    });

  const confirm = () =>
    run(async () => {
      if (!candidate) return;
      const { data, error: failure } = await client.current!.auth.getSession();
      if (
        failure ||
        !data.session ||
        data.session.user.id !== candidate.user.id
      )
        throw new Error(
          "The email account changed. Choose another email and sign in again.",
        );
      const { data: verified, error: userError } =
        await client.current!.auth.getUser();
      if (
        userError ||
        verified.user?.id !== candidate.user.id ||
        !verified.user.email_confirmed_at ||
        verified.user.email !== candidate.user.email
      )
        throw new Error("Confirm this email address before continuing.");
      if (!active.current) return;
      await finish(data.session);
    });

  const useAnotherEmail = () =>
    run(async () => {
      await signOutSupabase(url, publishableKey);
      if (active.current) {
        setCandidate(null);
        setEmail("");
        setPassword("");
        setStep("signin");
      }
    });
  const changeStep = (next: Step) => {
    setStep(next);
    setPassword("");
    setError(null);
    setNotice(null);
  };
  return {
    step,
    email,
    password,
    busy,
    error,
    notice,
    candidate,
    setEmail,
    setPassword,
    changeStep,
    submit,
    confirm,
    useAnotherEmail,
  };
}
