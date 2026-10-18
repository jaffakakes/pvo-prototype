import { useId } from "react";
import { useEmailSignIn, type EmailSignInOptions } from "./useEmailSignIn";
import styles from "./SupabaseEmailSignIn.module.css";

type Props = EmailSignInOptions & { onBack(): void; standalone?: boolean };

export function SupabaseEmailSignIn({
  onBack,
  standalone = false,
  ...options
}: Props) {
  const form = useEmailSignIn(options);
  const id = useId();
  const review = form.step === "review";
  const submitLabel =
    form.step === "signup"
      ? "Create account"
      : form.step === "forgot"
        ? "Send reset link"
        : form.step === "password"
          ? "Save new password"
          : "Sign in";
  return (
    <div
      className={`${styles.email} ${standalone ? styles.standalone : ""}`}
      data-supabase-email-sign-in
    >
      {!standalone && (
        <button type="button" className={styles.secondary} onClick={onBack}>
          {options.mode === "link"
            ? "Back to your account"
            : "Back to sign-in options"}
        </button>
      )}
      {review && form.candidate ? (
        <div className={styles.review} data-supabase-account-review>
          <p>
            {options.mode === "link" ? "Connect" : "Continue as"}{" "}
            <strong>{form.candidate.user.email}</strong>?
          </p>
          <p>
            {options.mode === "link"
              ? "Your existing projects and published links will stay with this Restyle account."
              : "This opens or creates the Restyle account for this email."}
          </p>
          <button
            type="button"
            disabled={form.busy}
            onClick={() => {
              void form.confirm();
            }}
          >
            {options.mode === "link"
              ? "Connect this email"
              : `Continue as ${form.candidate.user.email}`}
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={form.busy}
            onClick={() => {
              void form.useAnotherEmail();
            }}
          >
            Use another email
          </button>
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          {form.step !== "password" && (
            <label htmlFor={`${id}-email`}>
              Email address
              <input
                id={`${id}-email`}
                type="email"
                autoComplete="email"
                required
                value={form.email}
                disabled={form.busy}
                onChange={(event) => form.setEmail(event.target.value)}
              />
            </label>
          )}
          {form.step !== "forgot" && (
            <label htmlFor={`${id}-password`}>
              {form.step === "password" ? "New password" : "Password"}
              <input
                id={`${id}-password`}
                type="password"
                autoComplete={
                  form.step === "signin" ? "current-password" : "new-password"
                }
                required
                minLength={form.step === "signin" ? 1 : 8}
                value={form.password}
                disabled={form.busy}
                onChange={(event) => form.setPassword(event.target.value)}
              />
            </label>
          )}
          {(form.step === "signup" || form.step === "password") && (
            <p className={styles.status}>Use at least 8 characters.</p>
          )}
          <button type="submit" disabled={form.busy}>
            {form.busy ? "Please wait…" : submitLabel}
          </button>
          {form.step === "signin" && (
            <button
              className={styles.secondary}
              type="button"
              disabled={form.busy}
              onClick={() => form.changeStep("forgot")}
            >
              Forgot password?
            </button>
          )}
          {form.step === "forgot" && (
            <button
              className={styles.secondary}
              type="button"
              disabled={form.busy}
              onClick={() => form.changeStep("signin")}
            >
              Back to sign in
            </button>
          )}
          {!standalone &&
            (form.step === "signin" || form.step === "signup") && (
              <button
                className={styles.secondary}
                type="button"
                disabled={form.busy}
                onClick={() =>
                  form.changeStep(form.step === "signin" ? "signup" : "signin")
                }
              >
                {form.step === "signin"
                  ? "Create an account"
                  : "Sign in instead"}
              </button>
            )}
        </form>
      )}
      {form.notice && (
        <p className={styles.status} role="status">
          {form.notice}
        </p>
      )}
      {form.error && (
        <p className={styles.error} role="alert">
          {form.error}
        </p>
      )}
    </div>
  );
}
