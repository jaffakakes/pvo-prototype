import { useEffect, useRef, useState } from "react";
import { useCapture } from "../../state/captureStore";
import { useAuthGate } from "../../state/auth/authGateStore";
import { resolveTaskProject } from "../../infrastructure/assistant/savedTaskTransport";
import {
  createContainer,
  pendingContainerCreation,
  saveContainerCreation,
  type DraftCreation,
} from "../../infrastructure/services/drafts";
import { ServiceRequestError } from "../../infrastructure/services/client";

export function useContainerCreation(
  ownerId: string,
  onCreated: (id: string) => void,
) {
  const localId = useCapture((state) => state.localId);
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState<DraftCreation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    try {
      setPending(pendingContainerCreation(ownerId));
    } catch {
      setError(
        "Couldn’t read your saved creation request. Restore browser storage before creating a Container.",
      );
    }
    return () => {
      controller.abort();
      if (scope.current === controller) scope.current = null;
    };
  }, [ownerId]);
  const submit = async () => {
    const controller = scope.current;
    if (!controller || lock.current || (!pending && !localId)) return;
    const valid = () =>
      scope.current === controller &&
      !controller.signal.aborted &&
      useAuthGate.getState().user?.id === ownerId;
    lock.current = true;
    setBusy(true);
    setError(null);
    let command = pending;
    try {
      if (!command) {
        const projectId = await resolveTaskProject(localId!, controller.signal);
        if (!valid() || useCapture.getState().localId !== localId) return;
        command = {
          actionId: crypto.randomUUID(),
          projectId,
          description: description.trim(),
        };
      }
      saveContainerCreation(ownerId, command);
      setPending(command);
      const draft = await createContainer(ownerId, command, controller.signal);
      if (!valid()) return;
      saveContainerCreation(ownerId, null);
      setPending(null);
      setDescription("");
      onCreated(draft.identity.serviceId);
    } catch (failure) {
      if (!valid()) return;
      if (failure instanceof ServiceRequestError && failure.definitive) {
        try {
          saveContainerCreation(ownerId, null);
          setPending(null);
        } catch {
          /* Keep the exact saved request. */
        }
      }
      setError(
        failure instanceof Error
          ? failure.message
          : "Creation could not be confirmed. Retry the saved request.",
      );
    } finally {
      if (valid()) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  return { localId, description, setDescription, pending, busy, error, submit };
}
