import { createPvoRuntime } from "../../packages/pvo-sdk/index.js";
import { actionOperationIsCurrent } from "./operations.js";
import { clearRequestStatus, updateRequestStatus } from "./request-status.js";

export function createActionRuntimeAdapter({ session, refs, adapters }) {
  function makeActionRuntime(project) {
    let runtime;
    const contextIsCurrent = (context) => {
      if (session.actionRuntime !== runtime) return false;
      const operation = context?.playerInteraction?.operation;
      return !operation || actionOperationIsCurrent(session, operation);
    };

    runtime = createPvoRuntime(project, {
      show(component, context) {
        if (!contextIsCurrent(context)) return;
        session.forcedHidden.delete(component.id);
        session.forcedVisible.add(component.id);
        adapters.renderOverlays(true);
      },
      hide(component, context) {
        if (!contextIsCurrent(context)) return;
        const id = typeof component === "string" ? component : component?.id;
        if (id) {
          session.forcedVisible.delete(id);
          session.forcedHidden.add(id);
          adapters.renderOverlays(true);
        }
      },
      gotoScene(sceneId, context) {
        if (contextIsCurrent(context) && context.playerInteraction) {
          context.playerInteraction.outcome = { kind: "scene", sceneId };
        }
      },
      seek(seconds, context) {
        if (contextIsCurrent(context) && context.playerInteraction) {
          context.playerInteraction.outcome = { kind: "time", t: seconds };
        }
      },
      custom(name, payload, context) {
        if (!contextIsCurrent(context)) return undefined;
        if (name === "restyle_continue") {
          if (context.playerInteraction) context.playerInteraction.outcome = { kind: "continue" };
          return true;
        }
        const detail = {
          name,
          data: payload ?? {},
          componentId: context.componentId ?? null,
          sceneId: adapters.activeClip()?.scene,
          time: adapters.elapsedTime(),
        };
        refs.frame.dispatchEvent(new CustomEvent("pvo-custom", { detail }));
        return undefined;
      },
      openUrl(url, context) {
        if (!contextIsCurrent(context)) return undefined;
        if (!/^https?:\/\//i.test(url)) throw new Error("Only HTTP(S) links can be opened.");
        if (window.confirm(`Open ${new URL(url).host}?`)) window.open(url, "_blank", "noopener,noreferrer");
        return url;
      },
      request({ url, ...options }, context) {
        if (!contextIsCurrent(context)) throw new DOMException("The interaction is no longer active.", "AbortError");
        // Requests are performed by the trusted host, not inside the PVO renderer.
        // A redirect cannot silently escape the manifest's allowed_domains.
        return fetch(url, {
          ...options,
          signal: context.signal,
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
        });
      },
      onEvent(event) {
        if (session.actionRuntime !== runtime) return;
        if (event.type === "state" || event.type === "reset") {
          adapters.updateRuntimeState(event.state);
        }
        const requestId = typeof event.componentId === "string" ? event.componentId : null;
        if (event.type === "request_start") {
          if (requestId) {
            session.pendingRequestComponents.add(requestId);
            session.failedRequestComponents.delete(requestId);
          }
          updateRequestStatus(session, adapters.setStatus);
        } else if (event.type === "request_success" || event.type === "request_error") {
          if (requestId) session.pendingRequestComponents.delete(requestId);
          if (requestId && event.type === "request_success") session.failedRequestComponents.delete(requestId);
          if (requestId && event.type === "request_error") {
            if (event.handled === true) session.failedRequestComponents.delete(requestId);
            else session.failedRequestComponents.add(requestId);
          }
          updateRequestStatus(session, adapters.setStatus);
        }
      },
    });
    return runtime;
  }

  /** Replace the runtime so cancelled promises can only mutate an unreachable old instance. */
  function replaceActionRuntime(preserveState = false) {
    if (!session.manifest) {
      session.actionRuntime = null;
      return null;
    }
    const previous = session.actionRuntime;
    clearRequestStatus(session);
    const state = preserveState && previous ? structuredClone(previous.state) : null;
    const visible = preserveState && previous ? new Set(previous.visible) : null;
    const next = makeActionRuntime(session.manifest);
    if (state) next.state = state;
    if (visible) next.visible = visible;
    session.actionRuntime = next;
    session.runtimeStateRevision += 1;
    session.renderedOverlayKey = "";
    return next;
  }

  return { makeActionRuntime, replaceActionRuntime };
}
