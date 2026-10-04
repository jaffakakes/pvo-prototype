import { renderFieldsComponent } from "./fields-view.js";
import { renderManifestComponent } from "./manifest-view.js";

/** Local presentation diagnostics stay inside this view; sandboxed code has its own boundary. */
function applyInteractionStyles(root) {
  const style = document.createElement("style");
  const controls =
    ":is(button, a[href], input, select, textarea, [role=button])";
  const debug = document.querySelector("#playerShell.debug-hits");
  style.textContent = `
    :host ${controls}:focus-visible { outline: 3px solid #FFD23E; outline-offset: 2px; }
    ${
      debug
        ? `
      :host ${controls} {
        outline: 2px dashed #00E5A0 !important;
        outline-offset: -2px !important;
        box-shadow: inset 0 0 0 9999px rgba(0,229,160,.3) !important;
      }
      :host ${controls}:focus-visible { outline: 3px solid #FFD23E !important; outline-offset: 2px !important; }
    `
        : ""
    }
  `;
  root.append(style);
}

class PvoComponentView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("change", (event) => {
      if (this.fieldsComponent) return;
      const control = event.target;
      if (!(
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement
      ))
        return;
      if (
        (control.type === "radio" || control.type === "checkbox") &&
        !control.checked
      )
        return;
      const optionIndex =
        control instanceof HTMLSelectElement
          ? control.selectedIndex
          : Number(control.dataset.optionIndex);
      this.sendAnswer(optionIndex);
    });
    this.shadowRoot.addEventListener("click", (event) => {
      const button = event.target.closest?.("button");
      if (!button) return;
      if (this.fieldsComponent) {
        if (!button.hasAttribute("data-route-index")) return;
        event.preventDefault();
        this.dispatchEvent(
          new CustomEvent("pvo-field-answer", {
            bubbles: true,
            composed: true,
            detail: {
              componentId: this.componentId,
              index: Number(button.dataset.routeIndex),
            },
          }),
        );
        return;
      }
      if (button.type === "submit" && button.closest("form")) return;
      event.preventDefault();
      this.sendAnswer(Number(button.dataset.optionIndex));
    });
    this.shadowRoot.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.fieldsComponent) {
        const fields = Object.fromEntries(new FormData(event.target));
        this.dispatchEvent(
          new CustomEvent("pvo-field-answer", {
            bubbles: true,
            composed: true,
            detail: { componentId: this.componentId, index: 0, fields },
          }),
        );
        return;
      }
      const fields = Object.fromEntries(new FormData(event.target));
      this.dispatchEvent(
        new CustomEvent("pvo-form-submit", {
          bubbles: true,
          composed: true,
          detail: { componentId: this.componentId, fields },
        }),
      );
    });
  }

  update(component, selectedIndex, fieldsMode = false, visualUnit = 1) {
    this.componentId = component.id;
    this.component = component;
    this.fieldsComponent = fieldsMode ? component : null;
    if (fieldsMode)
      renderFieldsComponent(this.shadowRoot, component, visualUnit);
    else renderManifestComponent(this.shadowRoot, component, selectedIndex);
    applyInteractionStyles(this.shadowRoot);
  }

  setPending(pending) {
    const form = this.shadowRoot.querySelector("form");
    if (!form) return;
    form.setAttribute("aria-busy", String(Boolean(pending)));
    form
      .querySelectorAll("input, select, textarea, button")
      .forEach((control) => {
        control.disabled = Boolean(pending);
      });
    const submit = form.querySelector("button[type=submit]");
    if (submit)
      submit.textContent = pending
        ? this.component.restyle_capture?.form?.waitingLabel || "Sending…"
        : this.component.submit_label || "Send";
  }

  sendAnswer(optionIndex) {
    if (!Number.isInteger(optionIndex)) return;
    this.dispatchEvent(
      new CustomEvent("pvo-answer", {
        bubbles: true,
        composed: true,
        detail: { componentId: this.componentId, index: optionIndex },
      }),
    );
  }
}

export function registerComponentView() {
  customElements.define("pvo-component-view", PvoComponentView);
}
