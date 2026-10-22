import { useEffect, useRef, useState } from "react";
import { useAssistantScope } from "../../state/assistant/sessionScope";
import {
  listAgentIdentity,
  type IdentityList,
} from "../../infrastructure/connections/agentIdentity";

type View = IdentityList & { busy: boolean; error: string | null };
const empty: View = { channels: [], available: false, busy: true, error: null };

/** Private responses belong to one mounted account/project epoch, including switches away and back. */
export function useAgentIdentity() {
  const scope = useAssistantScope();
  const [state, setState] = useState<{ epoch: number; view: View }>({
    epoch: scope.epoch,
    view: empty,
  });
  const lifetime = useRef<AbortController | null>(null);
  const running = useRef(false);
  const view = state.epoch === scope.epoch ? state.view : empty;
  const current = (controller = lifetime.current) =>
    Boolean(
      controller &&
      controller === lifetime.current &&
      !controller.signal.aborted &&
      useAssistantScope.getState().epoch === scope.epoch,
    );
  const publish = (
    update: (value: View) => View,
    controller = lifetime.current,
  ) => {
    if (current(controller))
      setState((previous) => ({
        epoch: scope.epoch,
        view: update(previous.epoch === scope.epoch ? previous.view : empty),
      }));
  };
  async function load() {
    const controller = lifetime.current;
    if (!current(controller) || !scope.ownerId) return;
    const result = await listAgentIdentity(scope.ownerId, controller!.signal);
    publish((previous) => ({ ...previous, ...result }), controller);
  }
  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    const controller = lifetime.current;
    if (!current(controller) || running.current) return;
    running.current = true;
    publish(
      (previous) => ({ ...previous, busy: true, error: null }),
      controller,
    );
    try {
      await operation(controller!.signal);
    } catch (error) {
      publish(
        (previous) => ({
          ...previous,
          error:
            error instanceof Error
              ? error.message
              : "Setup could not finish. Refresh its saved status.",
        }),
        controller,
      );
    } finally {
      if (current(controller)) {
        running.current = false;
        publish((previous) => ({ ...previous, busy: false }), controller);
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    running.current = false;
    if (scope.ownerId) void run(load);
    else publish(() => ({ ...empty, busy: false }), controller);
    return () => controller.abort();
  }, [scope.epoch]);
  return {
    ...view,
    epoch: scope.epoch,
    ownerId: scope.ownerId,
    current,
    run,
    reload: load,
    refresh: () => run(load),
  };
}
export type IdentitySession = ReturnType<typeof useAgentIdentity>;
