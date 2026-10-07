import { useEffect, useRef, useState } from "react";
import {
  parseServiceDraftContent,
  type ServiceDraft,
  type ServiceDraftSave,
} from "../../../../packages/pvo-assistant/services/index.js";
import {
  readDraft,
  saveDraft,
  readDraftBuffer,
  saveDraftBuffer,
  type DraftBuffer,
} from "../../infrastructure/services/drafts";
import { ServiceRequestError } from "../../infrastructure/services/client";
import { useAuthGate } from "../../state/auth/authGateStore";

const fromRemote = (draft: ServiceDraft): DraftBuffer => ({
  base: draft,
  content: draft.content,
  agreementText: JSON.stringify(draft.content.agreement, null, 2),
  pending: null,
});
export function useContainerDraft(serviceId: string, ownerId: string) {
  const [buffer, setBuffer] = useState<DraftBuffer | null>(null);
  const [remote, setRemote] = useState<ServiceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const scope = useRef<AbortController | null>(null);
  const current = useRef<DraftBuffer | null>(null);
  const lock = useRef(false);
  const valid = (controller: AbortController) =>
    scope.current === controller &&
    !controller.signal.aborted &&
    useAuthGate.getState().user?.id === ownerId;
  const persist = (next: DraftBuffer) => {
    current.current = next;
    setBuffer(next);
    setDirty(true);
    try {
      saveDraftBuffer(ownerId, serviceId, next);
      return true;
    } catch {
      setError(
        "Browser storage could not save your edits. Keep this page open and retry saving.",
      );
      return false;
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    current.current = null;
    setBuffer(null);
    setRemote(null);
    setDirty(false);
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const local = readDraftBuffer(ownerId, serviceId);
        if (local && valid(controller)) {
          current.current = local;
          setBuffer(local);
          setDirty(true);
        }
        const draft = await readDraft(serviceId, ownerId, controller.signal);
        if (!valid(controller)) return;
        setRemote(draft);
        if (!local) {
          const next = fromRemote(draft);
          current.current = next;
          setBuffer(next);
        } else if (local.base.revision !== draft.revision && !local.pending)
          setError("A newer draft is saved. Your local edits are kept below.");
      } catch {
        if (valid(controller))
          setError(
            "Couldn’t load the saved draft. Reopen Containers to retry; local edits are kept.",
          );
      } finally {
        if (valid(controller)) setBusy(false);
      }
    })();
    return () => {
      controller.abort();
      if (scope.current === controller) scope.current = null;
    };
  }, [serviceId, ownerId]);
  const edit = (change: (value: DraftBuffer) => DraftBuffer) => {
    if (!current.current || lock.current || current.current.pending) return;
    setError(null);
    persist(change(current.current));
  };
  const send = async (useLatest = false) => {
    const controller = scope.current,
      value = current.current;
    if (!controller || !valid(controller) || !value || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let command: ServiceDraftSave | null = value.pending;
    try {
      command ??= {
        actionId: crypto.randomUUID(),
        expectedRevision:
          useLatest && remote ? remote.revision : value.base.revision,
        content: parseServiceDraftContent({
          ...value.content,
          agreement: JSON.parse(value.agreementText),
        }),
      };
      if (!persist({ ...value, pending: command })) return;
      const draft = await saveDraft(
        serviceId,
        ownerId,
        command,
        controller.signal,
      );
      if (!valid(controller)) return;
      // Clear pending storage only after the exact committed save is confirmed.
      saveDraftBuffer(ownerId, serviceId, null);
      const next = fromRemote(draft);
      current.current = next;
      setBuffer(next);
      setRemote(draft);
      setDirty(false);
    } catch (failure) {
      if (!valid(controller)) return;
      if (
        failure instanceof ServiceRequestError &&
        failure.definitive &&
        command
      ) {
        persist({ ...value, pending: null });
        try {
          const latest = await readDraft(serviceId, ownerId, controller.signal);
          if (valid(controller)) setRemote(latest);
        } catch {
          /* Keep the local edit and its revision. */
        }
      }
      if (valid(controller))
        setError(
          failure instanceof Error
            ? failure.message
            : "The save could not be confirmed. Retry the saved action.",
        );
    } finally {
      if (valid(controller)) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const useSaved = () => {
    if (!remote || lock.current || current.current?.pending) return;
    try {
      saveDraftBuffer(ownerId, serviceId, null);
      const next = fromRemote(remote);
      current.current = next;
      setBuffer(next);
      setDirty(false);
      setError(null);
    } catch {
      setError(
        "Couldn’t clear the local edits. Try again after restoring browser storage.",
      );
    }
  };
  const refresh = async () => {
    const controller = scope.current,
      before = current.current;
    if (!controller || !valid(controller) || lock.current || before?.pending)
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const latest = await readDraft(serviceId, ownerId, controller.signal);
      if (!valid(controller)) return;
      setRemote(latest);
      if (!dirty && current.current === before) {
        const next = fromRemote(latest);
        current.current = next;
        setBuffer(next);
      }
    } catch {
      if (valid(controller))
        setError("Couldn’t refresh the draft. Your local edits are kept.");
    } finally {
      if (valid(controller)) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  return {
    refresh,
    buffer,
    remote,
    busy,
    dirty,
    error,
    edit,
    save: () => send(),
    reapply: () => send(true),
    useSaved,
  };
}
