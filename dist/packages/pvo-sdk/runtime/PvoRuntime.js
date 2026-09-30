import { validatePvo } from "../manifest/validate.js";
import { writePath, readPath } from "./state-paths.js";
import { evaluateWhen, resolveTemplates } from "./conditions.js";
import { checkedRequestUrl } from "./request-policy.js";

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

  setState(key, value) {
    writePath(this.state, key, value);
    this.emit("state", { key, value });
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
    if (!evaluateWhen(action.when, actionContext)) return { skipped: true };

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
        this.setState(action.key, value);
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
        return this.execute(match?.then || action.else, actionContext);
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
        if (action.into && result !== undefined) this.setState(action.into, result);
        return result;
      }
      default:
        throw new Error(`Unsupported PVO action "${action.type}".`);
    }
  }

  async executeRequest(action, context) {
    let url = "";
    let method = String(action.method || "GET").toUpperCase();
    let data;
    try {
      url = checkedRequestUrl(resolveTemplates(action.url, context), this.manifest.allowed_domains);
      const resolvedBody = resolveTemplates(action.body, context);
      const headers = resolveTemplates(action.headers || {}, context);
      // A redirect to an undeclared host must not bypass allowed_domains.
      const options = {
        method,
        headers: { ...headers },
        redirect: "error",
        ...(context.signal ? { signal: context.signal } : {}),
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
      const response = this.handlers.request
        ? await this.handlers.request({ url, ...options }, context)
        : await fetch(url, options);
      throwIfAborted(context.signal);
      if (response && typeof response.json === "function") {
        if (!response.ok) throw new Error(`Request failed with ${response.status}.`);
        const type = response.headers?.get?.("content-type") || "";
        data = type.includes("json") ? await response.json() : await response.text();
      } else data = response;
      throwIfAborted(context.signal);
    } catch (error) {
      if (context.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const errorContext = { ...context, state: this.state, response: { error: message } };
      this.emit("request_error", {
        url,
        method,
        error: message,
        handled: action.on_error !== undefined && action.on_error !== null,
        componentId: context.componentId ?? null,
      });
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
    if (action.into) this.setState(action.into, data);
    const nextContext = { ...context, state: this.state, response: data };
    await this.execute(action.on_success, nextContext);
    throwIfAborted(context.signal);
    return data;
  }
}

export function createPvoRuntime(manifest, handlers = {}) {
  return new PvoRuntime(manifest, handlers);
}
