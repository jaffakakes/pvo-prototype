import { useId, useRef } from "react";
import { type IdentityProvider } from "../../../../packages/pvo-assistant/identity/index.js";
import styles from "./AgentIdentity.module.css";

export function IdentitySetupForm({
  provider,
  busy,
  cancel,
  submit,
}: {
  provider: IdentityProvider;
  busy: boolean;
  cancel(): void;
  submit(fields: Record<string, unknown>): void;
}) {
  const phone = provider === "agentphone";
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        submit({
          consent: true,
          monthlyNumberCents: phone ? 300 : 0,
        });
      }}
    >
      <p>
        {phone
          ? "AgentPhone creates a US phone number for your agent. The number costs US$3 per month; messages have separate charges."
          : "AgentMail creates an inbox for your agent. Its free plan has usage limits; paid upgrades stay under your control."}
      </p>
      <p className={styles.secondary}>
        Restyle uses your sign-in email to set this up for you. You’ll receive
        an ownership code there.{" "}
        {phone
          ? "Your agent gets its own number."
          : "Your agent gets its own inbox, without access to your personal mailbox."}
      </p>
      <label className={styles.permission}>
        <input type="checkbox" required disabled={busy} />
        <span>
          I approve this{" "}
          {phone
            ? "phone account and US$3 monthly number charge"
            : "agent inbox"}{" "}
          and accept the provider’s{" "}
          <a
            href={
              phone
                ? "https://agentphone.ai/terms"
                : "https://www.agentmail.to/legal/terms"
            }
            target="_blank"
            rel="noreferrer"
          >
            terms
          </a>
          .
        </span>
      </label>
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          {busy
            ? "Setting up…"
            : phone
              ? "Enable agent phone"
              : "Enable agent email"}
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function IdentityVerificationForm({
  busy,
  submit,
}: {
  busy: boolean;
  submit(code: string): void;
}) {
  const id = useId(),
    code = useRef<HTMLInputElement>(null);
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        const value = code.current!.value;
        code.current!.value = "";
        submit(value);
      }}
    >
      <label htmlFor={id}>Code sent to your email</label>
      <input
        ref={code}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        disabled={busy}
      />
      <p className={styles.secondary}>
        This code goes directly to private setup. It won’t enter the AI
        conversation.
      </p>
      <button type="submit" disabled={busy}>
        {busy ? "Checking verification…" : "Verify ownership"}
      </button>
    </form>
  );
}
