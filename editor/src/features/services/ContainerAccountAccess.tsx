import { useEffect, useRef, useState } from "react";
import { type ServiceAccountAccess } from "../../../../packages/pvo-assistant/hosting/index.js";
import { containerAccountAccess } from "../../infrastructure/services/accountAccess";
import { useAuthGate } from "../../state/auth/authGateStore";
import styles from "./ServicesPanel.module.css";

/** One checked version, explicit approval, and no connection keys in this view. */
export function ContainerAccountAccess({
  ownerId,
  serviceId,
  releaseId,
  label,
}: {
  ownerId: string;
  serviceId: string;
  releaseId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ServiceAccountAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setView(null);
    setError(null);
    if (open) {
      setBusy(true);
      void containerAccountAccess(
        ownerId,
        serviceId,
        releaseId,
        "inspect",
        controller.signal,
      )
        .then((result) => {
          if (
            !controller.signal.aborted &&
            useAuthGate.getState().user?.id === ownerId
          )
            setView(result);
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted)
            setError(
              failure instanceof Error
                ? failure.message
                : "Couldn’t check account access.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }
    return () => controller.abort();
  }, [open, ownerId, serviceId, releaseId]);
  async function change(kind: "inspect" | "approve" | "revoke") {
    const controller = lifetime.current;
    if (
      !controller ||
      controller.signal.aborted ||
      busy ||
      useAuthGate.getState().user?.id !== ownerId
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await containerAccountAccess(
        ownerId,
        serviceId,
        releaseId,
        kind,
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        useAuthGate.getState().user?.id === ownerId
      )
        setView(result);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Account access could not be updated.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{label}</summary>
      {open && (
        <section
          className={styles.recordArea}
          aria-label={label}
          aria-busy={busy}
        >
          {busy && <p role="status">Checking account access…</p>}
          {error && <p role="alert">{error}</p>}
          {view?.bindings.length === 0 && (
            <p>This version needs no outside account.</p>
          )}
          {view && view.bindings.length > 0 && (
            <>
              <p>
                {view.approved
                  ? "Approved for this version."
                  : "Review the requested access before publishing this version."}{" "}
                The account key stays private.
              </p>
              <ul className={styles.recordEvents}>
                {view.bindings.map((binding) => (
                  <li key={binding.name}>
                    <strong>{binding.description}</strong>
                    <p>
                      {binding.repository ?? "Connect the required account"}
                      {binding.account ? ` · ${binding.account}` : ""}
                    </p>
                    <p>
                      {binding.permission === "email:send"
                        ? "Can send email to the approved recipient"
                        : binding.method === "POST"
                          ? "Can create issues"
                          : "Can read selected information"}{" "}
                      · Used by {binding.operations.join(", ")}
                    </p>
                    {binding.error && <p>{binding.error}</p>}
                    {binding.callbackPath && (
                      <details>
                        <summary>Set up email delivery updates</summary>
                        <p>
                          In Resend, add this webhook URL for email delivery
                          events. Save its signing secret in your email
                          connection. Without it, Restyle uses limited receipt
                          checks.
                        </p>
                        <label>
                          Delivery update URL
                          <input
                            readOnly
                            value={
                              new URL(binding.callbackPath, location.origin)
                                .href
                            }
                          />
                        </label>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              <p>
                Try uses saved example replies. Published viewers can trigger
                only these approved actions. A new version needs its own
                approval.
              </p>
              <div className={styles.actions}>
                {!view.approved && (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      view.bindings.some((binding) => binding.error !== null)
                    }
                    onClick={() => void change("approve")}
                  >
                    Approve this version’s access
                  </button>
                )}
                {view.approved && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void change("revoke")}
                  >
                    Revoke this version’s access
                  </button>
                )}
              </div>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void change("inspect")}
          >
            Refresh account access
          </button>
        </section>
      )}
    </details>
  );
}
