import { useEffect, useId, useRef, useState } from "react";
import { type ConnectionSetup } from "../../../../packages/pvo-assistant/connections/index.js";
import styles from "./Connections.module.css";

export function ResendConnectionForm({
  setup,
  busy,
  continuing,
  submit,
  cancel,
}: {
  setup: Extract<ConnectionSetup, { provider: "resend" }> | null;
  busy: boolean;
  continuing: boolean;
  submit(setup: ConnectionSetup, token: string): void;
  cancel(): void;
}) {
  const id = useId(),
    key = useRef<HTMLInputElement>(null),
    webhook = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState(setup?.from ?? ""),
    [recipient, setRecipient] = useState(setup?.recipient ?? "");
  useEffect(() => {
    key.current?.focus();
  }, []);
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !key.current || !webhook.current) return;
        const credential = JSON.stringify({
          key: key.current.value.trim(),
          webhookSecret: webhook.current.value.trim(),
        });
        key.current.value = "";
        webhook.current.value = "";
        submit(
          {
            provider: "resend",
            from: from.trim(),
            recipient: recipient.trim(),
          },
          credential,
        );
      }}
    >
      <p>
        Let approved Containers send a plain-text email from one verified
        address to one recipient you choose.
      </p>
      <label htmlFor={`${id}-from`}>Verified sending address</label>
      <input
        id={`${id}-from`}
        type="email"
        required
        maxLength={254}
        value={from}
        readOnly={Boolean(setup)}
        disabled={busy}
        onChange={(event) => setFrom(event.currentTarget.value)}
      />
      <label htmlFor={`${id}-recipient`}>Approved recipient</label>
      <input
        id={`${id}-recipient`}
        type="email"
        required
        maxLength={254}
        value={recipient}
        readOnly={Boolean(setup)}
        disabled={busy}
        onChange={(event) => setRecipient(event.currentTarget.value)}
      />
      <p>
        Create a temporary full-access key in{" "}
        <a
          href="https://resend.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
        >
          Resend
        </a>
        . Restyle needs sending access and permission to read the delivery
        status. Your Resend sending allowance applies.
      </p>
      <label htmlFor={`${id}-key`}>Private Resend API key</label>
      <input
        ref={key}
        id={`${id}-key`}
        type="password"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        required
        maxLength={1024}
        disabled={busy}
      />
      <label htmlFor={`${id}-webhook`}>
        Delivery update signing secret (optional)
      </label>
      <input
        ref={webhook}
        id={`${id}-webhook`}
        type="password"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={206}
        disabled={busy}
      />
      <p>
        Without delivery callbacks, Restyle checks the saved email receipt at a
        limited interval. Both secrets stay encrypted on the server and clear
        from this form when submitted.
      </p>
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          {busy
            ? "Checking access…"
            : continuing
              ? "Connect and continue"
              : "Connect email sender"}
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
