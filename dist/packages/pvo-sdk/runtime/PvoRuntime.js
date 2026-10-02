import { validatePvo } from "../manifest/validate.js";
import { writePath, readPath } from "./state-paths.js";
import { evaluateWhen, resolveTemplates } from "./conditions.js";
import { checkedRequestUrl } from "./request-policy.js";
import { withRequestDeadline } from "./request-deadline.js";
import { describeRequestFailure, RequestHttpError } from "./request-failure.js";
import { createRuntimeDiagnostics } from "../diagnostics/runtime.js";
import { sanitizeDiagnosticUrl, sanitizeDiagnosticValue } from "../diagnostics/data.js";

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("The interaction was cancelled.");
  error.name = "AbortError";
  throw error;
}

export class PvoRuntime {
  constructor(manifest, handlers = {}) {
    const validation = validatePvo(manifest);
    if (!validation.valid) throw new Error(`Invalid PVO manifest:\n${validation.errors.join("\n")}`);
    this.manifest = manifest;
    this.handlers = handlers;
    this.state = structuredClone(manifest.state?.initial || {});
    this.visible = new Set();
    this.listeners = new Set();
    this.diagnostics = createRuntimeDiagnostics(handlers);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, detail = {}) {
    const snapshot = { type, state: structuredClone(this.state), visible: [...this.visible], ...detail };
    this.listeners.forEach((listener) => listener(snapshot));
    this.handlers.onEvent?.(snapshot);
  }

  setState(key, value, context) {
    const before = this.diagnostics.captureStateBefore(key, this.state);
    writePath(this.state, key, value);
    this.emit("state", { key, value });
    this.diagnostics.state(key, before, value, context);
  }

  reset() {
    this.state = structuredClone(this.manifest.state?.initial || {});
    this.visible.clear();
    this.emit("reset");
  }

  getComponent(idOrObject) {
    if (idOrObject && typeof idOrObject === "object") return idOrObject;
    return (this.manifest.components || []).find((component) => component.id === idOrObject);
  }

  async execute(actionOrActions, context = {}) {
    throwIfAborted(context.signal);
    if (Array.isArray(actionOrActions)) {
      let last;
      for (const action of actionOrActions) last = await this.execute(action, context);
      return last;
    }
    const action = actionOrActions;
    if (!action) return undefined;
    const actionContext = { ...context, state: this.state };
    const diagnostics = this.diagnostics;
    if (!diagnostics.enabled()) {
      if (!evaluateWhen(action.when, actionContext)) return { skipped: true };
      return this.performAction(action, actionContext);
    }
    const parentActionId = context.diagnostic?.actionId;
    const actionId = diagnostics.id("action");
    actionContext.diagnostic = { ...context.diagnostic, actionId };
    const detail = { actionType: String(action.type).slice(0, 64), ...(parentActionId ? { parentActionId } : {}) };
    diagnostics.emit("action.selected", actionContext, detail);
    const started = diagnostics.now();
    try {
      if (!evaluateWhen(action.when, actionContext)) {
        diagnostics.emit("action.skipped", actionContext, { ...detail, reason: "condition_false" });
        return { skipped: true };
      }
      diagnostics.emit("action.started", actionContext, detail);
      const result = await this.performAction(action, actionContext);
      diagnostics.emit("action.completed", actionContext, { ...detail, durationMs: diagnostics.now() - started });
      return result;
    } catch (error) {
      diagnostics.emit(context.signal?.aborted ? "action.cancelled" : "action.failed", actionContext, {
        ...detail,
        durationMs: diagnostics.now() - started,
        reason: context.signal?.aborted ? "interaction_cancelled" : "action_error",
        ...(!context.signal?.aborted ? { message: "Action could not finish." } : {}),
      });
      throw error;
    }
  }

  async performAction(action, actionContext) {
    switch (action.type) {
      case "show": {
        const component = this.getComponent(action.component);
        if (!component) throw new Error(`Cannot show missing component "${action.component}".`);
        if (component.id) this.visible.add(component.id);
        await this.handlers.show?.(component, actionContext);
        this.emit("show", { component: component.id || null });
        return component;
      }
      case "hide": {
        const component = this.getComponent(action.component);
        if (typeof action.component === "string") this.visible.delete(action.component);
        if (component?.id) this.visible.delete(component.id);
        await this.handlers.hide?.(component || action.component, actionContext);
        this.emit("hide", { component: component?.id || action.component });
        return undefined;
      }
      case "set": {
        const current = readPath(this.state, action.key);
        const value = Object.hasOwn(action, "add")
          ? Number(current || 0) + Number(resolveTemplates(action.add, actionContext))
          : resolveTemplates(action.value, actionContext);
        this.setState(action.key, value, actionContext);
        return value;
      }
      case "goto_scene": {
        await this.handlers.gotoScene?.(action.scene, actionContext);
        this.emit("goto_scene", { scene: action.scene });
        return action.scene;
      }
      case "seek": {
        if (action.scene) await this.handlers.gotoScene?.(action.scene, actionContext);
        else await this.handlers.seek?.(Number(action.time || 0), actionContext);
        this.emit("seek", { scene: action.scene, time: action.time });
        return action.scene ?? action.time;
      }
      case "chain":
        return this.execute(action.actions || [], actionContext);
      case "branch": {
        const match = (action.cases || []).find((item) => evaluateWhen(item.when, actionContext));
        const selected = match?.then || action.else;
        if (!selected) this.diagnostics.emit("action.skipped", actionContext, { reason: "no_matching_branch" });
        return this.execute(selected, actionContext);
      }
      case "request":
        return this.executeRequest(action, actionContext);
      case "open_url": {
        const url = resolveTemplates(action.url, actionContext);
        if (this.handlers.openUrl) return this.handlers.openUrl(url, actionContext);
        if (typeof window !== "undefined" && window.confirm(`Open ${new URL(url).host}?`)) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return url;
      }
      case "custom": {
        const result = await this.handlers.custom?.(action.name, resolveTemplates(action.payload, actionContext), actionContext);
        if (action.into && result !== undefined) this.setState(action.into, result, actionContext);
        return result;
      }
      default:
        throw new Error(`Unsupported PVO action "${action.type}".`);
    }
  }

  async executeRequest(action, context) {
    const diagnostics = this.diagnostics;
    const requestId = diagnostics.enabled() ? diagnostics.id("request") : null;
    const captured = diagnostics.capture();
    const started = diagnostics.now();
    let url = "";
    let method = String(action.method || "GET").toUpperCase();
    let data;
    let status;
    const detail = () => ({
      requestId, method: method.slice(0, 16), url: sanitizeDiagnosticUrl(url), captured,
      ...(status !== undefined ? { status } : {}),
    });
    try {
      url = resolveTemplates(action.url, context);
      url = checkedRequestUrl(url, this.manifest.allowed_domains);
      const resolvedBody = resolveTemplates(action.body, context);
      const headers = resolveTemplates(action.headers || {}, context);
      // A redirect to an undeclared host must not bypass allowed_domains.
      const options = {
        method,
        headers: { ...headers },
        redirect: "error",
      };
      if (resolvedBody != null && method !== "GET" && method !== "HEAD") {
        if (typeof resolvedBody === "string") options.body = resolvedBody;
        else {
          options.body = JSON.stringify(resolvedBody);
          if (!Object.keys(options.headers).some((key) => key.toLowerCase() === "content-type")) {
            options.headers["Content-Type"] = "application/json";
          }
        }
      }

      this.emit("request_start", { url, method, componentId: context.componentId ?? null });
      diagnostics.emit("request.started", context, {
        ...detail(),
        ...(captured && resolvedBody != null ? { requestBody: sanitizeDiagnosticValue(resolvedBody) } : {}),
      });
      data = await withRequestDeadline(async (signal) => {
        const requestOptions = { ...options, signal };
        // Hosts receive the same composed signal through both existing adapter shapes.
        const response = this.handlers.request
          ? await this.handlers.request({ url, ...requestOptions }, { ...context, signal })
          : await fetch(url, requestOptions);
        if (response && typeof response.json === "function") {
          status = diagnostics.responseStatus(response);
          if (!response.ok) throw new RequestHttpError(response.status);
          const type = response.headers?.get?.("content-type") || "";
          return type.includes("json") ? response.json() : response.text();
        }
        return response;
      }, context.signal);
      throwIfAborted(context.signal);
    } catch (error) {
      if (context.signal?.aborted) {
        diagnostics.emit("request.cancelled", context, {
          ...detail(), durationMs: diagnostics.now() - started, reason: "interaction_cancelled",
        });
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failure = describeRequestFailure(error);
      diagnostics.emit(failure.kind === "policy" ? "request.rejected" : "request.failed", context, {
        ...detail(),
        durationMs: diagnostics.now() - started,
        failure: { ...failure },
        reason: failure.kind,
        handled: action.on_error !== undefined && action.on_error !== null,
      });
      const errorContext = { ...context, state: this.state, response: { error: message } };
      this.emit("request_error", {
        url,
        method,
        error: message,
        failure,
        handled: action.on_error !== undefined && action.on_error !== null,
        componentId: context.componentId ?? null,
      });
      if (action.on_error == null)
        diagnostics.emit("action.skipped", context, { reason: "no_error_route", requestId });
      await this.execute(action.on_error, errorContext);
      // An imperative pvo.request() call needs a rejecting Promise so creator
      // functions can handle failure. Declarative manifest actions default to
      // a quiet no-op when no on_error action is configured.
      if (context.throwOnRequestError) throw error instanceof Error ? error : new Error(message);
      return undefined;
    }

    throwIfAborted(context.signal);
    // This event closes the network lifecycle. Authored success actions run
    // afterward and may fail independently without leaving hosts pending or
    // turning a completed request into a network error.
    this.emit("request_success", { url, method, response: data, componentId: context.componentId ?? null });
    diagnostics.emit("request.completed", context, {
      ...detail(), durationMs: diagnostics.now() - started,
      ...(captured ? { responseBody: sanitizeDiagnosticValue(data) } : {}),
    });
    if (action.into) this.setState(action.into, data, context);
    const nextContext = { ...context, state: this.state, response: data };
    await this.execute(action.on_success, nextContext);
    throwIfAborted(context.signal);
    return data;
  }
}

export function createPvoRuntime(manifest, handlers = {}) {
  return new PvoRuntime(manifest, handlers);
}
