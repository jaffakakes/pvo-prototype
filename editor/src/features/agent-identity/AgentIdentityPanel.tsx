import { useState } from "react";
import {
  IDENTITY_PROVIDERS,
  type IdentityChannel,
  type IdentityProvider,
} from "../../../../packages/pvo-assistant/identity/index.js";
import {
  changeAgentIdentity,
  type IdentityAction,
} from "../../infrastructure/connections/agentIdentity";
import {
  IdentitySetupForm,
  IdentityVerificationForm,
} from "./IdentitySetupForm";
import { IdentityImportForm } from "./IdentityImportForm";
import { useAgentIdentity, type IdentitySession } from "./useAgentIdentity";
import styles from "./AgentIdentity.module.css";

const statusCopy: Record<IdentityChannel["status"], string> = {
  starting: "Account setup started",
  awaiting_verification: "Waiting for your email code",
  verifying: "Checking and saving identity",
  ready: "Connected",
  needs_attention: "Setup needs attention",
  disconnected: "Restyle access removed",
};
function IdentityChannelPanel({
  provider,
  channel,
  session,
}: {
  provider: IdentityProvider;
  channel: IdentityChannel | undefined;
  session: IdentitySession;
}) {
  const [form, setForm] = useState<"start" | "import" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const working =
    channel?.status === "starting" || channel?.status === "verifying";
  const revision = channel?.revision ?? 0;
  const change = (
    action: IdentityAction,
    fields: Record<string, unknown> = {},
  ) => {
    void session.run(async (signal) => {
      await changeAgentIdentity(
        session.ownerId!,
        action,
        provider,
        revision,
        fields,
        signal,
      );
      if (!session.current()) return;
      setForm(null);
      setConfirmDisconnect(false);
      await session.reload();
    });
  };
  const phone = provider === "agentphone";
  return (
    <section
      className={styles.channel}
      aria-label={phone ? "Agent phone" : "Agent email"}
    >
      <h4>{phone ? "Agent phone" : "Agent email"}</h4>
      <p>
        {channel?.address ??
          (phone
            ? "A phone number for service verification."
            : "An inbox for service accounts and verification.")}
      </p>
      {channel && (
        <p role="status" className={styles.secondary}>
          {statusCopy[channel.status]}
        </p>
      )}
      {channel?.issue && <p role="status">{channel.issue}</p>}
      {form === "start" && (
        <IdentitySetupForm
          provider={provider}
          busy={session.busy}
          cancel={() => setForm(null)}
          submit={(fields) => change("start", fields)}
        />
      )}
      {form === "import" && (
        <IdentityImportForm
          key={revision}
          provider={provider}
          revision={revision}
          session={session}
          cancel={() => setForm(null)}
          submit={(fields) => change("import", fields)}
        />
      )}
      {!form && channel?.status === "awaiting_verification" && (
        <IdentityVerificationForm
          busy={session.busy}
          submit={(code) => change("verify", { code })}
        />
      )}
      {!form && !confirmDisconnect && (
        <div className={styles.actions}>
          {!channel && (
            <button
              type="button"
              disabled={session.busy || !session.available}
              onClick={() => setForm("start")}
            >
              {phone ? "Set up agent phone" : "Set up agent email"}
            </button>
          )}
          {!working && (
            <button
              type="button"
              disabled={session.busy || !session.available}
              onClick={() => setForm("import")}
            >
              {channel ? "Reconnect privately" : "Use an existing account"}
            </button>
          )}
          {channel && (
            <button
              type="button"
              disabled={session.busy || !session.available}
              onClick={() => change("check")}
            >
              Check saved setup
            </button>
          )}
          {channel?.status === "awaiting_verification" && (
            <button
              type="button"
              disabled={session.busy || !session.available}
              onClick={() => change("resend")}
            >
              Resend ownership code
            </button>
          )}
          {channel && channel.status !== "disconnected" && !working && (
            <button
              type="button"
              disabled={session.busy}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect
            </button>
          )}
        </div>
      )}
      {confirmDisconnect && (
        <div>
          <p>
            Remove Restyle’s saved access? The provider account stays open.{" "}
            {phone &&
              "Your number and its monthly charges stay with AgentPhone until you release it there."}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={session.busy}
              onClick={() => change("disconnect")}
            >
              Remove Restyle access
            </button>
            <button
              type="button"
              disabled={session.busy}
              onClick={() => setConfirmDisconnect(false)}
            >
              Keep connected
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function AgentIdentityPanel() {
  const session = useAgentIdentity();
  if (!session.ownerId) return null;
  return (
    <section
      className={styles.panel}
      aria-label="Agent identity"
      aria-busy={session.busy}
    >
      <h3>Agent identity</h3>
      <p>
        Your agent keeps the same inbox and phone number when its working
        computer shuts down. They belong to your account.
      </p>
      <p className={styles.secondary}>
        Service signup automation is being connected in beta. Setting up an
        identity does not start calls, send messages or purchase another
        service.
      </p>
      {session.error && <p role="alert">{session.error}</p>}
      {!session.available && !session.busy && (
        <p>
          Private identity setup is unavailable on this server. Your saved setup
          stays here.
        </p>
      )}
      {session.busy && session.channels.length === 0 && (
        <p role="status">Loading your agent’s saved identity…</p>
      )}
      {IDENTITY_PROVIDERS.map((provider) => (
        <IdentityChannelPanel
          key={`${session.epoch}:${provider}`}
          provider={provider}
          channel={session.channels.find((item) => item.provider === provider)}
          session={session}
        />
      ))}
      <button
        type="button"
        disabled={session.busy}
        onClick={() => {
          void session.refresh();
        }}
      >
        Refresh agent identity
      </button>
    </section>
  );
}
