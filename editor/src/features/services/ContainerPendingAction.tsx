import { useEffect, useRef, useState } from "react";
import { type ServiceRecordsArea } from "../../../../packages/pvo-assistant/hosting/index.js";
import { resumeContainerAccountAction } from "../../infrastructure/services/accountAccess";
import { useAuthGate } from "../../state/auth/authGateStore";

export function ContainerPendingAction({
  ownerId,
  serviceId,
  pending,
  disabled,
  refresh,
}: {
  ownerId: string;
  serviceId: string;
  pending: NonNullable<ServiceRecordsArea["pending"]>;
  disabled: boolean;
  refresh(): void;
}) {
  const lifetime = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  async function resume() {
    const controller = lifetime.current;
    const valid = () =>
      controller &&
      !controller.signal.aborted &&
      useAuthGate.getState().user?.id === ownerId;
    if (!valid() || busy || !controller) return;
    setBusy(true);
    setError(null);
    try {
      await resumeContainerAccountAction(
        serviceId,
        pending.actionId,
        controller.signal,
      );
      if (valid()) refresh();
    } catch (failure) {
      if (valid())
        setError(
          failure instanceof Error
            ? failure.message
            : "This saved action still needs checking.",
        );
    } finally {
      if (valid()) setBusy(false);
    }
  }
  return (
    <section aria-label="Pending outside action" aria-busy={busy}>
      <h5>Outside action needs attention</h5>
      <p>
        {pending.operation} · Started{" "}
        {new Date(pending.startedAt).toLocaleString()}
      </p>
      <p>
        Resume checks any uncertain request before continuing the remaining
        approved steps. It never resends an unknown write. Keep this saved
        action until its outcome is known.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void resume()}
      >
        {busy ? "Checking saved action…" : "Resume saved action"}
      </button>
    </section>
  );
}
