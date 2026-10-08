import { connectionScopeKey } from "../../../../packages/pvo-assistant/connections/index.js";
import { ResendConnectionForm } from "./ResendConnectionForm";
import { useState } from "react";
import {
  type TaskRecord,
  type TaskQuestion,
} from "../../../../packages/pvo-assistant/tasks/index.js";
import { openSignIn } from "../../state/auth/authGateStore";
import {
  attachAccountConnection,
  connectAccount,
  controlAccountConnection,
  type AccountConnection,
} from "../../infrastructure/connections/accountConnections";
import { ConnectionForm } from "./ConnectionForm";
import { useAccountConnections } from "./useAccountConnections";
import styles from "./Connections.module.css";

type TaskSetup = {
  task: TaskRecord;
  question: TaskQuestion;
  updated(): void;
  decline(): void;
};
export function ConnectionsPanel({ taskSetup }: { taskSetup?: TaskSetup }) {
  const session = useAccountConnections();
  const [form, setForm] = useState<{
    id: string;
    existing: AccountConnection | null;
    provider: "github" | "resend";
  } | null>(null);
  const pending = taskSetup?.question.connection;
  async function attach(id: string, signal: AbortSignal) {
    if (!taskSetup || !session.current()) return;
    await attachAccountConnection(
      session.ownerId!,
      id,
      taskSetup.task,
      taskSetup.question.id,
      crypto.randomUUID(),
      signal,
    );
    if (session.current()) taskSetup.updated();
  }
  if (!session.ownerId)
    return (
      <button type="button" onClick={() => openSignIn()}>
        Sign in to connect an account
      </button>
    );
  return (
    <section
      className={styles.panel}
      aria-label="Account connections"
      aria-busy={session.busy}
    >
      {pending && <p>{taskSetup.question.prompt}</p>}
      <p>Connected accounts let Restyle use the specific access you approve.</p>
      {session.error && <p role="alert">{session.error}</p>}
      {session.items.length === 0 && !session.busy && (
        <p>No accounts connected yet.</p>
      )}
      {!session.available && !session.busy && (
        <p>
          Private account setup is not configured on this server. Your saved
          task can wait here.
        </p>
      )}
      <ul className={styles.list}>
        {session.items.map((item) => (
          <li key={item.connection.id}>
            <strong>{item.connection.name}</strong>
            {item.scope.provider === "resend" && (
              <p>
                From {item.scope.from} · To {item.scope.recipient}
              </p>
            )}
            <p>
              {item.account} ·{" "}
              {item.connection.status === "connected"
                ? item.scope.provider === "resend"
                  ? "Connected · email sending allowed"
                  : item.connection.permissions.includes("issues:write")
                    ? "Connected · issue creation allowed"
                    : "Connected · read only"
                : item.connection.status === "expired"
                  ? "Access needs attention · reconnect"
                  : "Disconnected"}
            </p>
            {item.expiresAt !== null && (
              <p>
                Token expires {new Date(item.expiresAt).toLocaleDateString()}.
              </p>
            )}
            <div className={styles.actions}>
              {pending &&
                connectionScopeKey(pending) ===
                  connectionScopeKey(item.scope) &&
                item.connection.status === "connected" &&
                (pending.provider !== "github" ||
                  pending.access !== "issues_write" ||
                  item.connection.permissions.includes("issues:write")) && (
                  <button
                    disabled={session.busy}
                    type="button"
                    onClick={() => {
                      void session.run((signal) =>
                        attach(item.connection.id, signal),
                      );
                    }}
                  >
                    Use connection and continue
                  </button>
                )}
              {item.connection.status === "connected" && (
                <button
                  disabled={session.busy}
                  type="button"
                  onClick={() => {
                    void session.run(async (signal) => {
                      await controlAccountConnection(
                        session.ownerId!,
                        "check",
                        item.connection,
                        signal,
                      );
                      await session.reload();
                    });
                  }}
                >
                  Check access
                </button>
              )}
              <button
                type="button"
                disabled={session.busy || !session.available}
                onClick={() =>
                  setForm({
                    id: item.connection.id,
                    existing: item,
                    provider: item.scope.provider,
                  })
                }
              >
                Reconnect
              </button>
              {item.connection.status !== "revoked" && (
                <button
                  disabled={session.busy}
                  type="button"
                  onClick={() => {
                    void session.run(async (signal) => {
                      await controlAccountConnection(
                        session.ownerId!,
                        "disconnect",
                        item.connection,
                        signal,
                      );
                      await session.reload();
                    });
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {form &&
        (() => {
          const setup = form.existing?.scope ?? pending ?? null;
          const props = {
            key: form.id,
            busy: session.busy,
            continuing: Boolean(
              pending &&
              (!form.existing ||
                connectionScopeKey(form.existing.scope) ===
                  connectionScopeKey(pending)),
            ),
            cancel: () => setForm(null),
            submit: (
              scope: import("../../../../packages/pvo-assistant/connections/index.js").ConnectionSetup,
              token: string,
            ) => {
              void session.run(async (signal) => {
                const saved = await connectAccount(
                  session.ownerId!,
                  form.id,
                  form.existing?.connection.revision ?? 0,
                  scope,
                  token,
                  signal,
                );
                if (!session.current()) return;
                setForm(null);
                await session.reload();
                if (
                  pending &&
                  connectionScopeKey(pending) ===
                    connectionScopeKey(saved.scope)
                )
                  await attach(saved.connection.id, signal);
              });
            },
          };
          return form.provider === "resend" ? (
            <ResendConnectionForm
              {...props}
              setup={setup?.provider === "resend" ? setup : null}
            />
          ) : (
            <ConnectionForm
              {...props}
              setup={setup?.provider === "github" ? setup : null}
            />
          );
        })()}
      <div className={styles.actions}>
        {!form && (
          <button
            type="button"
            disabled={session.busy || !session.available}
            onClick={() =>
              setForm({
                id: crypto.randomUUID(),
                existing: null,
                provider: pending?.provider ?? "github",
              })
            }
          >
            {pending?.provider === "resend"
              ? "Connect email sender"
              : "Connect GitHub"}
          </button>
        )}
        {!form && !pending && (
          <button
            type="button"
            disabled={session.busy || !session.available}
            onClick={() =>
              setForm({
                id: crypto.randomUUID(),
                existing: null,
                provider: "resend",
              })
            }
          >
            Connect email sender
          </button>
        )}
        <button
          type="button"
          disabled={session.busy}
          onClick={() => {
            void session.refresh();
          }}
        >
          Refresh connections
        </button>
        {session.next && (
          <button
            type="button"
            disabled={session.busy}
            onClick={() => {
              void session.more();
            }}
          >
            Load more connections
          </button>
        )}
        {taskSetup && (
          <button
            type="button"
            disabled={session.busy}
            onClick={taskSetup.decline}
          >
            Continue without this connection
          </button>
        )}
      </div>
      <p>
        Disconnect removes Restyle’s saved key and blocks future calls. You can
        also revoke the key in the provider’s settings.
      </p>
    </section>
  );
}
