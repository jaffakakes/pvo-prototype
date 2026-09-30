import {
  createPvoRuntime,
  PVO_SPEC_VERSION,
  type PvoRuntime,
} from "../../../../packages/pvo-sdk/index.js";
import { collectRequestDomains } from "../../domain/components/actions";
import type {
  PlaybackOutcome,
  PvoComponent,
  Scene,
} from "../../domain/project/model";

type RuntimeState = {
  tryMode: unknown | null;
  components: PvoComponent[];
};

type RuntimeSource = {
  scenes: Scene[];
  allowedDomains: string[];
};

type Host = {
  getState(): RuntimeState;
  request: typeof fetch;
  publishRuntimeState(state: Record<string, unknown> | null): void;
  applyPlaybackOutcome(
    component: PvoComponent,
    outcome: PlaybackOutcome,
  ): boolean;
};

/** Owns the SDK runtime and translates its host effects into Try-session commands. */
export function createTryRuntimeBridge(host: Host) {
  let runtime: PvoRuntime | null = null;
  let unsubscribe: (() => void) | null = null;

  function current(): PvoRuntime | null {
    return runtime;
  }

  function isCurrent(candidate: PvoRuntime | null): boolean {
    return runtime === candidate;
  }

  function recordPlaybackResult(
    context: Record<string, unknown>,
    applied: boolean,
  ): void {
    if (applied) return;
    const interaction = context.previewInteraction;
    if (interaction && typeof interaction === "object")
      (interaction as { routeFailed?: boolean }).routeFailed = true;
  }

  function componentFromContext(
    context: Record<string, unknown>,
  ): PvoComponent | undefined {
    const id = context.componentId;
    return typeof id === "string"
      ? host.getState().components.find((item) => item.id === id)
      : undefined;
  }

  function clearConnection(): void {
    runtime = null;
    const disconnect = unsubscribe;
    unsubscribe = null;
    disconnect?.();
  }

  function stop(): void {
    clearConnection();
    host.publishRuntimeState(null);
  }

  function start(source: RuntimeSource): PvoRuntime {
    if (runtime || unsubscribe) stop();

    let candidate: PvoRuntime | null = null;
    try {
      const allowed_domains = collectRequestDomains(
        source.scenes,
        source.allowedDomains,
      );
      const active = () => runtime === candidate && !!host.getState().tryMode;
      candidate = createPvoRuntime(
        {
          spec_version: PVO_SPEC_VERSION,
          scenes: [{ id: "main", start: 0, end: 1 }],
          components: [],
          allowed_domains,
        },
        {
          gotoScene: (sceneId, context) => {
            if (!active()) return;
            const component = componentFromContext(context);
            if (component)
              recordPlaybackResult(
                context,
                host.applyPlaybackOutcome(component, {
                  kind: "scene",
                  sceneId,
                }),
              );
          },
          seek: (time, context) => {
            if (!active()) return;
            const component = componentFromContext(context);
            if (component)
              recordPlaybackResult(
                context,
                host.applyPlaybackOutcome(component, { kind: "time", t: time }),
              );
          },
          custom: (name, _payload, context) => {
            if (!active()) return;
            const component = componentFromContext(context);
            if (name === "restyle_continue" && component)
              recordPlaybackResult(
                context,
                host.applyPlaybackOutcome(component, { kind: "continue" }),
              );
          },
          request: ({ url, ...options }) =>
            host.request(url, {
              ...options,
              credentials: "omit",
              redirect: "error",
              referrerPolicy: "no-referrer",
            }),
        },
      );
      runtime = candidate;
      unsubscribe = candidate.subscribe((event) => {
        if (
          (event.type === "state" || event.type === "reset") &&
          runtime === candidate &&
          host.getState().tryMode
        )
          host.publishRuntimeState(event.state);
      });
      host.publishRuntimeState(structuredClone(candidate.state));
      return candidate;
    } catch (error) {
      if (runtime === candidate) clearConnection();
      try {
        host.publishRuntimeState(null);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Could not start or clean up the Try runtime.",
        );
      }
      throw error;
    }
  }

  return { current, isCurrent, start, stop };
}
