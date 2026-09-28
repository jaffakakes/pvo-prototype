import { createPvoRuntime } from "../../packages/pvo-sdk/index.js";

export function createActionRuntimeAdapter({ session, refs, adapters }) {
  function makeActionRuntime(project) {
    return createPvoRuntime(project, {
      show(component) {
        session.forcedHidden.delete(component.id);
        session.forcedVisible.add(component.id);
        adapters.renderOverlays(true);
      },
      hide(component) {
        const id = typeof component === "string" ? component : component?.id;
        if (id) {
          session.forcedVisible.delete(id);
          session.forcedHidden.add(id);
          adapters.renderOverlays(true);
        }
      },
      gotoScene(sceneId, context) {
        if (context.playerInteraction) context.playerInteraction.outcome = { kind: "scene", sceneId };
      },
      seek(seconds, context) {
        if (context.playerInteraction) context.playerInteraction.outcome = { kind: "time", t: seconds };
      },
      custom(name, payload, context) {
        if (name === "restyle_continue") {
          if (context.playerInteraction) context.playerInteraction.outcome = { kind: "continue" };
          return true;
        }
        const detail = { name, data: payload ?? {}, componentId: context.componentId ?? null,
          sceneId: adapters.activeClip()?.scene, time: adapters.elapsedTime() };
        refs.frame.dispatchEvent(new CustomEvent("pvo-custom", { detail }));
        return undefined;
      },
      openUrl(url) {
        if (!/^https?:\/\//i.test(url)) throw new Error("Only HTTP(S) links can be opened.");
        if (window.confirm(`Open ${new URL(url).host}?`)) window.open(url, "_blank", "noopener,noreferrer");
        return url;
      },
      request({ url, ...options }) {
        // Requests are performed by the trusted host, not inside the PVO renderer.
        // A redirect cannot silently escape the manifest's allowed_domains.
        return fetch(url, { ...options, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
      },
      onEvent(event) {
        if (event.type === "request_start") adapters.setStatus("Connecting…", false, true);
        else if (event.type === "request_success") adapters.setStatus("");
        else if (event.type === "request_error") adapters.setStatus("Request unavailable", true);
      },
    });
  }

  return { makeActionRuntime };
}
