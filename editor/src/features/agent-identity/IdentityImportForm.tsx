import { useEffect, useId, useRef, useState } from "react";
import { type IdentityProvider } from "../../../../packages/pvo-assistant/identity/index.js";
import {
  discoverAgentIdentity,
  type IdentityResource,
} from "../../infrastructure/connections/agentIdentity";
import { type IdentitySession } from "./useAgentIdentity";
import styles from "./AgentIdentity.module.css";

/** The key stays in its private input for resource selection, then is cleared before saving or unmounting. */
export function IdentityImportForm({
  provider,
  revision,
  session,
  cancel,
  submit,
}: {
  provider: IdentityProvider;
  revision: number;
  session: IdentitySession;
  cancel(): void;
  submit(fields: Record<string, unknown>): void;
}) {
  const id = useId(),
    token = useRef<HTMLInputElement>(null),
    resource = useRef<HTMLSelectElement>(null);
  const [choices, setChoices] = useState<{
    resources: IdentityResource[];
    more: boolean;
  } | null>(null);
  const phone = provider === "agentphone";
  useEffect(() => {
    const input = token.current;
    return () => {
      if (input) input.value = "";
    };
  }, []);
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!choices) {
          const key = token.current!.value.trim();
          void session.run(async (signal) => {
            const found = await discoverAgentIdentity(
              session.ownerId!,
              provider,
              revision,
              key,
              signal,
            );
            if (session.current()) setChoices(found);
          });
          return;
        }
        const key = token.current!.value.trim(),
          resourceId = resource.current!.value;
        token.current!.value = "";
        submit({ resourceId, token: key, consent: true });
      }}
    >
      <p>
        Connect the {phone ? "number" : "inbox"} you already own. Restyle saves
        the key privately and reuses this identity for your tasks.
      </p>
      <label htmlFor={`${id}-key`}>
        {phone ? "AgentPhone" : "AgentMail"} API key
      </label>
      <input
        ref={token}
        id={`${id}-key`}
        type="password"
        autoComplete="off"
        spellCheck={false}
        maxLength={2048}
        minLength={20}
        required
        readOnly={Boolean(choices)}
        disabled={session.busy}
      />
      <p className={styles.secondary}>
        Find it in your{" "}
        <a
          href={
            phone
              ? "https://agentphone.ai/dashboard"
              : "https://console.agentmail.to"
          }
          target="_blank"
          rel="noreferrer"
        >
          provider dashboard
        </a>
        . Keep it out of chat.
      </p>
      {!choices && (
        <label className={styles.permission}>
          <input type="checkbox" required disabled={session.busy} />
          <span>
            I allow Restyle to check my owned {phone ? "numbers" : "inboxes"}{" "}
            and save the identity I choose.
          </span>
        </label>
      )}
      {choices && choices.resources.length > 0 && (
        <>
          <label htmlFor={`${id}-resource`}>
            {phone ? "Agent phone number" : "Agent inbox"}
          </label>
          <select
            ref={resource}
            id={`${id}-resource`}
            required
            disabled={session.busy}
          >
            {choices.resources.map((item) => (
              <option key={item.resourceId} value={item.resourceId}>
                {item.address}
              </option>
            ))}
          </select>
        </>
      )}
      {choices?.resources.length === 0 && (
        <p role="status">
          No matching active {phone ? "number" : "inbox"} was found. Check your
          provider dashboard and use a key for this saved identity.
        </p>
      )}
      {choices?.more && (
        <p className={styles.secondary}>
          The provider has more identities. Use a key scoped to the inbox you
          need, or check your provider dashboard.
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="submit"
          disabled={session.busy || choices?.resources.length === 0}
        >
          {session.busy
            ? "Checking private setup…"
            : choices
              ? "Save this identity"
              : phone
                ? "Find my numbers"
                : "Find my inboxes"}
        </button>
        <button
          type="button"
          disabled={session.busy}
          onClick={() => {
            if (token.current) token.current.value = "";
            cancel();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
