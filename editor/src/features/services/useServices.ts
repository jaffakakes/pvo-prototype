import { useEffect, useRef, useState } from "react";
import { useAuthGate } from "../../state/auth/authGateStore";
import {
  listServices,
  sendControl,
  readPendingControl,
  savePendingControl,
  ServiceRequestError,
  type ManagedService,
  type PendingControl,
} from "../../infrastructure/services/client";
import type { ServiceControl } from "../../../../packages/pvo-assistant/hosting/index.js";

type View = {
  services: ManagedService[];
  pending: PendingControl | null;
  busy: boolean;
  error: string | null;
};
const empty: View = { services: [], pending: null, busy: false, error: null };
/** Account-scoped request ownership; an uncertain control is saved before sending and retried unchanged. */
export function useServices() {
  const ownerId = useAuthGate((s) => s.user?.id ?? null);
  const [view, setView] = useState<View>(empty);
  const owner = useRef<{ id: string; controller: AbortController } | null>(
    null,
  );
  const lock = useRef(false);
  const pending = useRef<PendingControl | null>(null);
  const valid = (scope: NonNullable<typeof owner.current>) =>
    owner.current === scope &&
    !scope.controller.signal.aborted &&
    useAuthGate.getState().user?.id === scope.id;
  const refresh = async () => {
    const scope = owner.current;
    if (!scope || lock.current) return;
    lock.current = true;
    setView((v) => ({ ...v, busy: true, error: null }));
    try {
      const services = await listServices(scope.id, scope.controller.signal);
      if (valid(scope)) setView((v) => ({ ...v, services }));
    } catch {
      if (valid(scope))
        setView((v) => ({
          ...v,
          error: "Couldn’t load your services. Try Refresh.",
        }));
    } finally {
      if (valid(scope)) {
        lock.current = false;
        setView((v) => ({ ...v, busy: false }));
      }
    }
  };
  useEffect(() => {
    owner.current?.controller.abort();
    pending.current = null;
    lock.current = false;
    setView(empty);
    if (!ownerId) {
      owner.current = null;
      return;
    }
    const scope = { id: ownerId, controller: new AbortController() };
    owner.current = scope;
    try {
      pending.current = readPendingControl(ownerId);
      setView({ ...empty, pending: pending.current });
      void refresh();
    } catch {
      setView({
        ...empty,
        error:
          "Couldn’t read the saved service action. Reopen this panel after restoring browser storage.",
      });
    }
    return () => {
      scope.controller.abort();
      if (owner.current === scope) owner.current = null;
    };
  }, [ownerId]);
  const send = async (next: PendingControl) => {
    const scope = owner.current;
    if (!scope || !valid(scope) || lock.current) return;
    lock.current = true;
    setView((v) => ({ ...v, busy: true, error: null }));
    try {
      savePendingControl(scope.id, next);
      pending.current = next;
      setView((v) => ({ ...v, pending: next }));
      const summary = await sendControl(
        next,
        scope.id,
        scope.controller.signal,
      );
      if (!valid(scope)) return;
      savePendingControl(scope.id, null);
      pending.current = null;
      setView((v) => ({
        ...v,
        pending: null,
        services:
          summary.service.state === "deleted"
            ? v.services.filter(
                (item) => item.metadata.identity.serviceId !== next.serviceId,
              )
            : v.services.map((item) =>
                item.metadata.identity.serviceId === next.serviceId
                  ? {
                      metadata: {
                        ...item.metadata,
                        state: summary.service.state,
                      },
                      summary,
                    }
                  : item,
              ),
      }));
    } catch (error) {
      if (!valid(scope)) return;
      if (error instanceof ServiceRequestError && error.definitive) {
        try {
          savePendingControl(scope.id, null);
          pending.current = null;
        } catch {
          /* Keep the saved command available if storage failed. */
        }
      }
      setView((v) => ({
        ...v,
        pending: pending.current,
        error:
          error instanceof ServiceRequestError
            ? error.message
            : "The action could not be confirmed. Use Retry saved action before making another change.",
      }));
    } finally {
      if (valid(scope)) {
        lock.current = false;
        setView((v) => ({ ...v, busy: false }));
      }
    }
  };
  const control = (
    item: ManagedService,
    kind: ServiceControl["kind"],
    selectedReleaseId?: string,
  ) => {
    if (pending.current || !item.summary) return;
    const service = item.summary.service;
    const releaseId =
      selectedReleaseId ?? service.liveReleaseId ?? service.testReleaseId;
    if (kind === "activate" && !releaseId) return;
    const base = {
      actionId: crypto.randomUUID(),
      expectedRevision: service.revision,
    };
    const control: ServiceControl =
      kind === "activate"
        ? { ...base, kind, releaseId: releaseId! }
        : { ...base, kind };
    void send({ serviceId: service.identity.serviceId, control });
  };
  return {
    ...view,
    ownerId,
    refresh,
    control,
    retry: () => pending.current && send(pending.current),
  };
}
