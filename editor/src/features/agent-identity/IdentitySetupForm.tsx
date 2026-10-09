import { useId, useRef, useState } from "react";
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
  const id = useId();
  const email = useRef<HTMLInputElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const phone = provider === "agentphone";
  const [initialName] = useState(
    () => `restyle-${crypto.randomUUID().slice(0, 8)}`,
  );
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        const humanEmail = email.current!.value.trim(),
          agentName = name.current!.value.trim();
        email.current!.value = "";
        submit({
          humanEmail,
          name: agentName,
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
      <label htmlFor={`${id}-email`}>
        Your email for ownership verification
      </label>
      <input
        ref={email}
        id={`${id}-email`}
        type="email"
        autoComplete="email"
        maxLength={254}
        required
        disabled={busy}
      />
      <label htmlFor={`${id}-name`}>Agent name</label>
      <input
        ref={name}
        id={`${id}-name`}
        type="text"
        defaultValue={initialName}
        pattern="[a-z][a-z0-9-]{2,63}"
        minLength={3}
        maxLength={64}
        required
        disabled={busy}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className={styles.secondary}>
        Use lowercase letters, numbers and hyphens. You’ll receive a code at
        your own email.
      </p>
      <label className={styles.permission}>
        <input type="checkbox" required disabled={busy} />
        <span>
          I approve this{" "}
          {phone
            ? "phone account and US$3 monthly number charge"
            : "email account"}{" "}
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
          {busy ? "Saving setup…" : "Create agent account"}
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
