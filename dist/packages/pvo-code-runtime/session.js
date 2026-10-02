import { setRenderedFormPending } from "./form-feedback.js";
import {
  boundedSource,
  METHODS,
  RENDER_CSP,
  START_TIMEOUT_MS,
  EVENT_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  MAX_ACTION_BYTES,
  MAX_RESPONSE_BYTES,
  MAX_ACTIONS_PER_SECOND,
} from "./policy.js";
import { channelId, runtimeDocument } from "./runtime-document.js";
import { createRenderer } from "./renderer.js";

function formFields(form) {
  const result = Object.create(null);
  for (const [key, value] of new FormData(form)) {
    if (
      typeof key !== "string" ||
      key.length > 64 ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    )
      continue;
    if (Object.keys(result).length >= 20) break;
    result[key] = String(value).slice(0, 500);
  }
  return result;
}

/**
 * Mount a single custom component. The caller is responsible for validating
 * each `onAction({method,args})` against the current PVO manifest/state.
 */
export function mountCustomComponent(container, initial) {
  if (!(container instanceof Element))
    throw new TypeError("A container Element is required.");
  let options = { ...initial };
  let sources = boundedSource(options);
  let disposed = false;
  let renderLoaded = false;
  let renderSucceeded = false;
  let runtimeReady = false;
  let workerReady = false;
  let handlers = new Map();
  let eventSerial = 0;
  let actionTimes = [];
  const pending = new Map();
  const invokeQueue = [];
  const channel = channelId();
  const nonce = channelId();

  function diagnostic(type, detail = {}) {
    if (disposed || typeof options.onDiagnostic !== "function") return;
    try {
      const result = options.onDiagnostic({ type, componentId: options.componentId, ...detail });
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch { /* An observer cannot change sandbox execution. */ }
  }
  const report = (error, reason = "runtime_error") => {
    if (!disposed) {
      diagnostic("component.failed", { reason });
      options.onError?.(
        typeof error === "string" ? error : String(error?.message || error),
      );
    }
  };
  const renderFrame = document.createElement("iframe");
  const renderShell = document.createElement("div");
  renderShell.style.cssText =
    "display:block;position:relative;width:247px;height:1px;flex:none;";
  renderFrame.setAttribute("sandbox", "allow-same-origin"); // scripts remain disabled
  renderFrame.setAttribute(
    "title",
    `Component ${options.componentId || "preview"}`,
  );
  renderFrame.style.cssText =
    "display:block;border:0;overflow:hidden;transform-origin:top left;";
  renderFrame.style.pointerEvents =
    options.interactive === false ? "none" : "auto";
  renderFrame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}#pvo-root{display:inline-block;max-width:100%}</style><div id="pvo-root"></div>`;
  const runtimeFrame = document.createElement("iframe");
  runtimeFrame.setAttribute("sandbox", "allow-scripts"); // opaque origin; no storage/parent DOM
  runtimeFrame.setAttribute("aria-hidden", "true");
  runtimeFrame.tabIndex = -1;
  runtimeFrame.style.cssText =
    "position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  runtimeFrame.srcdoc = runtimeDocument(channel, nonce);

  const renderer = createRenderer(renderFrame, renderShell, error => {
    renderSucceeded = false;
    report(error, "render_error");
  }, (next) => {
    handlers = next;
  });
  function fitRenderer() {
    renderer.fit(options);
  }
  function applyRender() {
    if (!renderLoaded || disposed) return;
    renderSucceeded = true;
    renderer.render(sources, options);
  }

  function armEventTimer(eventId, delay) {
    const entry = pending.get(eventId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (!pending.has(eventId)) return;
      report("Component function timed out and was restarted.", "function_timeout");
      restartWorker();
    }, delay);
  }

  function dispatchNext() {
    if (
      !runtimeReady ||
      !workerReady ||
      disposed ||
      pending.size ||
      !invokeQueue.length
    )
      return;
    const { handler, fields, eventId } = invokeQueue.shift();
    pending.set(eventId, { timer: null, requests: new Set() });
    armEventTimer(eventId, EVENT_TIMEOUT_MS);
    diagnostic("action.started", { eventId, phase: "bridge" });
    runtimeFrame.contentWindow?.postMessage(
      { channel, kind: "invoke", eventId, ...handler, fields },
      "*",
    );
  }

  function invoke(handler, fields, eventId) {
    if (!runtimeReady || !workerReady || disposed) {
      diagnostic("interaction.ignored", { eventId, reason: "not_ready" });
      return report("Component Functions are not ready.");
    }
    if (invokeQueue.length >= 20) {
      diagnostic("interaction.ignored", { eventId, reason: "queue_full" });
      return report("Component action queue is full.");
    }
    invokeQueue.push({ handler, fields, eventId });
    dispatchNext();
  }

  function finishEvent(eventId) {
    const entry = pending.get(eventId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(eventId);
    dispatchNext();
  }

  function finishRequest(data, ok, value) {
    const entry = pending.get(data.eventId);
    if (!entry || !entry.requests.has(data.requestId)) return;
    entry.requests.delete(data.requestId);
    const message = {
      channel,
      kind: "request-result",
      eventId: data.eventId,
      requestId: data.requestId,
      ok,
    };
    if (ok) message.value = value;
    else
      message.error = String(
        value?.message || value || "Request failed.",
      ).slice(0, 500);
    runtimeFrame.contentWindow?.postMessage(message, "*");
    armEventTimer(
      data.eventId,
      entry.requests.size ? REQUEST_TIMEOUT_MS : EVENT_TIMEOUT_MS,
    );
  }

  function onRendererClick(event) {
    const element = event.target?.closest?.("[data-pvo-click]");
    if (element) {
      event.preventDefault();
      const eventId = ++eventSerial;
      diagnostic("interaction.received", { eventId, target: element.getAttribute("data-pvo-id")?.slice(0, 80) });
      const handler = handlers.get(element.getAttribute("data-pvo-click"));
      if (handler)
        invoke(
          handler,
          element.closest("form") ? formFields(element.closest("form")) : {},
          eventId,
        );
      else diagnostic("interaction.ignored", { eventId, reason: "no_matching_rule" });
      return;
    }
    // The scriptless renderer deliberately has neither allow-forms nor a
    // form-action permission. Browser-native submit events are suppressed in
    // that sandbox, so bridge an explicit submit-button activation instead.
    const button = event.target?.closest?.('button[type="submit"]');
    const form = button?.closest("form");
    if (!form) return;
    event.preventDefault();
    submitForm(form);
  }

  function onRendererSubmit(event) {
    event.preventDefault(); // no navigation or native form submission
    submitForm(event.target);
  }

  function submitForm(form) {
    const eventId = ++eventSerial;
    diagnostic("interaction.received", { eventId, target: "submit" });
    if (options.pending) {
      diagnostic("interaction.ignored", { eventId, reason: "request_pending" });
      return;
    }
    if (!form?.checkValidity?.()) {
      diagnostic("interaction.ignored", { eventId, reason: "invalid_fields" });
      form?.reportValidity?.();
      return;
    }
    const handler = handlers.get(form.getAttribute("data-pvo-submit"));
    if (handler) invoke(handler, formFields(form), eventId);
    else diagnostic("interaction.ignored", { eventId, reason: "no_matching_rule" });
  }

  function onRendererKeyDown(event) {
    if (
      event.key !== "Enter" ||
      event.isComposing ||
      event.target?.localName !== "input"
    )
      return;
    const form = event.target.closest("form");
    if (!form) return;
    event.preventDefault();
    submitForm(form);
  }

  function restartWorker() {
    if (!runtimeReady || disposed) return;
    workerReady = false;
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
    invokeQueue.length = 0;
    runtimeFrame.contentWindow?.postMessage(
      { channel, kind: "start", js: sources.js },
      "*",
    );
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      if (workerReady || disposed) return;
      runtimeFrame.contentWindow?.postMessage({ channel, kind: "stop" }, "*");
      report("Component Functions did not start and were stopped.", "start_timeout");
    }, START_TIMEOUT_MS);
  }

  let startTimer = setTimeout(() => {
    if (!runtimeReady) report("Component sandbox did not start.", "sandbox_timeout");
  }, START_TIMEOUT_MS);
  function onRuntimeMessage(event) {
    if (
      disposed ||
      event.source !== runtimeFrame.contentWindow ||
      event.data?.channel !== channel
    )
      return;
    const data = event.data;
    if (data.kind === "frame-ready") {
      runtimeReady = true;
      restartWorker();
      return;
    }
    if (data.kind === "ready") {
      workerReady = true;
      clearTimeout(startTimer);
      if (renderSucceeded) diagnostic("component.ready");
      dispatchNext();
      return;
    }
    if (data.kind === "error") {
      if (Number.isInteger(data.eventId)) finishEvent(data.eventId);
      report(data.message || "Component Functions error.");
      return;
    }
    if (data.kind === "done") {
      diagnostic("action.completed", { eventId: data.eventId, phase: "bridge" });
      if (Number.isInteger(data.eventId)) finishEvent(data.eventId);
      return;
    }
    if (
      data.kind !== "action" ||
      !workerReady ||
      !pending.has(data.eventId) ||
      !METHODS.has(data.method) ||
      !Array.isArray(data.args)
    )
      return;
    const isRequest = data.method === "request";
    if (isRequest) {
      if (!Number.isSafeInteger(data.requestId) || data.requestId < 1) return;
      const entry = pending.get(data.eventId);
      if (entry.requests.has(data.requestId)) return;
      entry.requests.add(data.requestId);
    }
    let size;
    try {
      size = JSON.stringify(data.args).length;
    } catch {
      size = Infinity;
    }
    if (size > MAX_ACTION_BYTES) {
      diagnostic("interaction.ignored", { eventId: data.eventId, reason: "action_too_large" });
      if (isRequest)
        finishRequest(data, false, "Component request is too large.");
      else report("Component action is too large.");
      return;
    }
    const now = performance.now();
    actionTimes = actionTimes.filter((time) => now - time < 1_000);
    if (actionTimes.length >= MAX_ACTIONS_PER_SECOND) {
      diagnostic("interaction.ignored", { eventId: data.eventId, reason: "rate_limit" });
      if (isRequest)
        finishRequest(data, false, "Component action rate limit reached.");
      else report("Component action rate limit reached.");
      return;
    }
    actionTimes.push(now);
    if (!isRequest) {
      Promise.resolve()
        .then(() =>
          options.onAction?.({ method: data.method, args: data.args }, { eventId: data.eventId }),
        )
        .catch(report);
      return;
    }
    if (
      data.args.length !== 1 ||
      !data.args[0] ||
      typeof data.args[0] !== "object" ||
      Array.isArray(data.args[0])
    ) {
      diagnostic("interaction.ignored", { eventId: data.eventId, reason: "invalid_request" });
      finishRequest(
        data,
        false,
        "pvo.request expects one configuration object.",
      );
      return;
    }
    armEventTimer(data.eventId, REQUEST_TIMEOUT_MS);
    Promise.resolve()
      .then(() => {
        if (!options.onAction)
          throw new Error("Requests are unavailable in this PVO host.");
        return options.onAction({ method: "request", args: data.args }, { eventId: data.eventId });
      })
      .then(
        (value) => {
          let safe;
          try {
            const json = JSON.stringify(value ?? null);
            if (json.length > MAX_RESPONSE_BYTES)
              throw new Error("Request response is too large.");
            safe = JSON.parse(json);
          } catch (error) {
            finishRequest(data, false, error);
            return;
          }
          finishRequest(data, true, safe);
        },
        (error) => finishRequest(data, false, error),
      );
  }

  function onRenderLoad() {
    if (disposed) return;
    renderLoaded = true;
    const doc = renderFrame.contentDocument;
    if (!doc) return report("Component renderer is unavailable.");
    doc.addEventListener("click", onRendererClick, true);
    doc.addEventListener("submit", onRendererSubmit, true);
    doc.addEventListener("keydown", onRendererKeyDown, true);
    applyRender();
    if (workerReady && renderSucceeded) diagnostic("component.ready");
  }

  renderFrame.addEventListener("load", onRenderLoad);
  window.addEventListener("message", onRuntimeMessage);
  renderShell.append(renderFrame);
  container.append(renderShell, runtimeFrame);

  return {
    update(next = {}) {
      if (disposed) return;
      const previousJs = sources.js;
      const merged = { ...options, ...next };
      let updated;
      try {
        updated = boundedSource(merged);
      } catch (error) {
        report(error);
        return;
      }
      options = merged;
      sources = updated;
      renderFrame.style.pointerEvents =
        options.interactive === false ? "none" : "auto";
      applyRender();
      if (sources.js !== previousJs) restartWorker();
    },
    setInteractive(value) {
      if (disposed) return;
      options.interactive = Boolean(value);
      renderFrame.style.pointerEvents = options.interactive ? "auto" : "none";
    },
    setPending(value) {
      if (disposed) return;
      options.pending = Boolean(value);
      setRenderedFormPending(
        renderFrame.contentDocument?.getElementById("pvo-root"),
        options.pending,
      );
      fitRenderer();
    },
    destroy() {
      if (disposed) return;
      diagnostic("component.inactive", { reason: "disposed" });
      disposed = true;
      renderer.dispose();
      clearTimeout(startTimer);
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
      invokeQueue.length = 0;
      window.removeEventListener("message", onRuntimeMessage);
      renderFrame.contentDocument?.removeEventListener(
        "click",
        onRendererClick,
        true,
      );
      renderFrame.contentDocument?.removeEventListener(
        "submit",
        onRendererSubmit,
        true,
      );
      renderFrame.contentDocument?.removeEventListener(
        "keydown",
        onRendererKeyDown,
        true,
      );
      runtimeFrame.contentWindow?.postMessage({ channel, kind: "stop" }, "*");
      renderShell.remove();
      runtimeFrame.remove();
    },
  };
}
