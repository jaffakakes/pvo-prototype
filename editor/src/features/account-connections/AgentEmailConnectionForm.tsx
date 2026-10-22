import { useId, useState } from "react";
import { type ConnectionSetup } from "../../../../packages/pvo-assistant/connections/index.js";
import styles from "./Connections.module.css";

export function AgentEmailConnectionForm({
  setup,
  busy,
  continuing,
  submit,
  cancel,
}: {
  setup: Extract<
    ConnectionSetup,
    { provider: "agentmail"; recipient: string }
  > | null;
  busy: boolean;
  continuing: boolean;
  submit(setup: ConnectionSetup, token: string): void;
  cancel(): void;
}) {
  const id = useId();
  const [recipient, setRecipient] = useState(setup?.recipient ?? "");
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy)
          submit({ provider: "agentmail", recipient: recipient.trim() }, "");
      }}
    >
      <p>
        Let approved Containers send plain-text email from your agent inbox to
        this recipient. Set up agent email below first. Your AgentMail sending
        allowance applies.
      </p>
      <label htmlFor={`${id}-recipient`}>Approved recipient</label>
      <input
        id={`${id}-recipient`}
        className={styles.recipient}
        type="email"
        required
        maxLength={254}
        autoComplete="email"
        value={recipient}
        readOnly={Boolean(setup)}
        disabled={busy}
        onChange={(event) => setRecipient(event.currentTarget.value)}
      />
      <p>
        This approval does not send an email. The component supplies the subject
        and message when used. An accepted receipt confirms sending was
        requested; it does not confirm delivery.
      </p>
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          {busy
            ? "Checking agent email…"
            : continuing
              ? "Approve recipient and continue"
              : "Approve recipient"}
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
