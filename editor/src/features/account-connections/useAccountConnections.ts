import { useEffect, useRef, useState } from "react";
import { useAssistantScope } from "../../state/assistant/sessionScope";
import {
  listAccountConnections,
  type AccountConnection,
} from "../../infrastructure/connections/accountConnections";

type View = {
  items: AccountConnection[];
  next: string | null;
  available: boolean;
  busy: boolean;
  error: string | null;
};
const empty: View = {
  items: [],
  next: null,
  available: false,
  busy: true,
  error: null,
};

/** Requests and private results belong to one account/project epoch and mounted panel. */
export function useAccountConnections() {
  const scope = useAssistantScope();
  const [state, setState] = useState<{ epoch: number; view: View }>({
    epoch: scope.epoch,
    view: empty,
  });
  const lifetime = useRef<AbortController | null>(null);
  const view = state.epoch === scope.epoch ? state.view : empty;
  const current = () =>
    !lifetime.current?.signal.aborted &&
    useAssistantScope.getState().epoch === scope.epoch;
  const publish = (
    update: (value: View) => View,
    controller = lifetime.current,
  ) => {
    if (
      controller === lifetime.current &&
      !controller?.signal.aborted &&
      current()
    )
      setState((previous) => ({
        epoch: scope.epoch,
        view: update(previous.epoch === scope.epoch ? previous.view : empty),
      }));
  };
  async function load(after: string | null = null) {
    if (!lifetime.current || lifetime.current.signal.aborted) return;
    const controller = lifetime.current;
    const page = await listAccountConnections(
      scope.ownerId!,
      after,
      controller.signal,
    );
    publish(
      (previous) => ({
        ...previous,
        ...page,
        items: after
          ? [
              ...previous.items.filter(
                (item) =>
                  !page.items.some(
                    (next) => next.connection.id === item.connection.id,
                  ),
              ),
              ...page.items,
            ]
          : page.items,
      }),
      controller,
    );
  }
  const running = useRef(false);
  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (running.current || !lifetime.current || !current()) return;
    const controller = lifetime.current;
    const active = () =>
      controller === lifetime.current &&
      !controller.signal.aborted &&
      current();
    running.current = true;
    publish((value) => ({ ...value, busy: true, error: null }));
    try {
      await operation(controller.signal);
    } catch (error) {
      if (active())
        publish((value) => ({
          ...value,
          error:
            error instanceof Error
              ? error.message
              : "This connection could not finish. Refresh and retry.",
        }));
    } finally {
      if (active()) {
        running.current = false;
        publish((value) => ({ ...value, busy: false }));
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    running.current = false;
    if (scope.ownerId) void run(() => load());
    else publish(() => ({ ...empty, busy: false }));
    return () => {
      controller.abort();
    };
  }, [scope.epoch]);
  return {
    ...view,
    ownerId: scope.ownerId,
    current,
    run,
    refresh: () => run(() => load()),
    more: () => run(() => load(view.next)),
    reload: load,
  };
}
