import { useEffect, useId, useRef, useState } from "react";
import { type ConnectionSetup } from "../../../../packages/pvo-assistant/connections/index.js";
import styles from "./Connections.module.css";

export function ConnectionForm({
  setup,
  busy,
  continuing,
  submit,
  cancel,
}: {
  setup: Extract<ConnectionSetup, { provider: "github" }> | null;
  busy: boolean;
  continuing: boolean;
  submit(setup: ConnectionSetup, token: string): void;
  cancel(): void;
}) {
  const id = useId();
  const secret = useRef<HTMLInputElement>(null);
  useEffect(() => {
    secret.current?.focus();
  }, []);
  const [writeIssues, setWriteIssues] = useState(
    setup?.access === "issues_write",
  );
  const [repository, setRepository] = useState(setup?.repository ?? "");
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !secret.current) return;
        const token = secret.current.value.trim();
        secret.current.value = "";
        submit(
          {
            provider: "github",
            repository: repository.trim(),
            ...(writeIssues ? { access: "issues_write" as const } : {}),
          },
          token,
        );
      }}
    >
      <p>Allow Restyle to use selected actions in one GitHub repository.</p>
      <label htmlFor={`${id}-repo`}>Repository</label>
      <input
        id={`${id}-repo`}
        required
        maxLength={140}
        value={repository}
        readOnly={Boolean(setup)}
        disabled={busy}
        placeholder="owner/repository"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(event) => setRepository(event.currentTarget.value)}
      />
      <label className={styles.permission}>
        <input
          type="checkbox"
          checked={writeIssues}
          disabled={busy || setup?.access === "issues_write"}
          onChange={(event) => setWriteIssues(event.currentTarget.checked)}
        />
        Allow issue creation for Containers I approve
      </label>
      <p>
        Create a{" "}
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noopener noreferrer"
        >
          fine-grained GitHub token
        </a>
        . Select this repository only, give Issues{" "}
        {writeIssues ? "read and write" : "read-only"} permission, and set an
        expiry. Metadata read access is included by GitHub.
      </p>
      <label htmlFor={`${id}-key`}>Private access token</label>
      <input
        ref={secret}
        id={`${id}-key`}
        type="password"
        required
        maxLength={256}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        disabled={busy}
        aria-describedby={`${id}-privacy`}
      />
      <p id={`${id}-privacy`}>
        Sent privately to Restyle’s server and stored encrypted. The AI and your
        component files never receive it. The field clears when you submit.
      </p>
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          {busy
            ? "Checking access…"
            : continuing
              ? "Connect and continue"
              : "Connect account"}
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
