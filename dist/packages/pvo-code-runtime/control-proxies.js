/** WebKit blocks parent-owned event listeners inside a script-disabled iframe. */
export function createControlProxies(frame, shell, activate, interactive) {
  if (navigator.vendor !== "Apple Computer, Inc.") return { sync() {}, setInteractive() {}, destroy() {} };

  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;z-index:1;pointer-events:none;";
  shell.append(layer);

  function setInteractive(value) {
    layer.style.display = value ? "block" : "none";
  }
  setInteractive(interactive);

  function sync(scale = 1) {
    layer.replaceChildren();
    const doc = frame.contentDocument;
    if (!doc) return;
    for (const control of doc.querySelectorAll("button[data-pvo-click],button[type=submit]")) {
      const box = control.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const proxy = document.createElement("button");
      proxy.type = "button";
      proxy.setAttribute("data-pvo-control-proxy", "");
      proxy.setAttribute("aria-label", control.textContent?.trim() || "Activate component");
      proxy.disabled = control.disabled;
      proxy.style.cssText = "position:absolute;margin:0;padding:0;border:0;background:rgba(0,0,0,.001);color:transparent;pointer-events:auto;cursor:pointer;";
      proxy.style.left = `${box.left * scale}px`;
      proxy.style.top = `${box.top * scale}px`;
      proxy.style.width = `${box.width * scale}px`;
      proxy.style.height = `${box.height * scale}px`;
      proxy.addEventListener("click", event => { event.preventDefault(); activate(control); });
      control.setAttribute("aria-hidden", "true");
      control.tabIndex = -1;
      layer.append(proxy);
    }
  }

  return { sync, setInteractive, destroy() { layer.remove(); } };
}
