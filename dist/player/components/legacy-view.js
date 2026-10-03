import { fontFamily } from "../../packages/pvo-fonts/index.js";
import { applyComponentAppearance } from "./appearance.js";

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  template.content.querySelectorAll("script, iframe, object, embed, link, meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if (["href", "src"].includes(name) && /^javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function sanitizeCss(css) {
  return String(css || "").replace(/@import[^;]+;/gi, "").replace(/url\([^)]*\)/gi, "none");
}

class PvoComponentView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("change", (event) => {
      if (this.captureComponent) return;
      const control = event.target;
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
      if ((control.type === "radio" || control.type === "checkbox") && !control.checked) return;
      const optionIndex = control instanceof HTMLSelectElement
        ? control.selectedIndex
        : Number(control.dataset.optionIndex);
      this.sendAnswer(optionIndex);
    });
    this.shadowRoot.addEventListener("click", (event) => {
      const button = event.target.closest?.("button");
      if (!button) return;
      if (this.captureComponent) {
        if (!button.hasAttribute("data-route-index")) return;
        event.preventDefault();
        this.dispatchEvent(new CustomEvent("pvo-field-answer", {
          bubbles: true, composed: true,
          detail: { componentId: this.componentId, index: Number(button.dataset.routeIndex) },
        }));
        return;
      }
      if (button.type === "submit" && button.closest("form")) return;
      event.preventDefault();
      this.sendAnswer(Number(button.dataset.optionIndex));
    });
    this.shadowRoot.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.captureComponent) {
        const fields = Object.fromEntries(new FormData(event.target));
        this.dispatchEvent(new CustomEvent("pvo-field-answer", {
          bubbles: true, composed: true,
          detail: { componentId: this.componentId, index: 0, fields },
        }));
        return;
      }
      const fields = Object.fromEntries(new FormData(event.target));
      this.dispatchEvent(new CustomEvent("pvo-form-submit", {
        bubbles: true, composed: true,
        detail: { componentId: this.componentId, fields },
      }));
    });
  }

  update(component, selectedIndex, fieldsMode = false, visualUnit = 1) {
    this.componentId = component.id;
    this.component = component;
    this.visualUnit = visualUnit;
    this.captureComponent = fieldsMode ? component : null;
    if (fieldsMode) {
      this.updateFields(component);
      return;
    }
    this.shadowRoot.innerHTML = `<style>
      :host { display: block; width: 100%; height: 100%; }
      * { box-sizing: border-box; }
      .component-root { width: 100%; height: 100%; }
      ${sanitizeCss(component.css)}
    </style><div class="component-root">${sanitizeHtml(component.html)}</div>`;
    if (component.kind === "choice" || component.kind === "card") {
      const count = component.kind === "choice" ? component.options?.length : component.actions?.length;
      const buttons = this.shadowRoot.querySelectorAll("button");
      buttons.forEach((button, index) => {
        if (index >= count) return;
        button.dataset.optionIndex = String(index);
        button.setAttribute("aria-pressed", String(index === selectedIndex));
        button.toggleAttribute("data-selected", index === selectedIndex);
      });
      this.shadowRoot.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input, index) => {
        if (index >= count) return;
        input.dataset.optionIndex = String(index);
        input.checked = index === selectedIndex;
      });
      this.shadowRoot.querySelectorAll("select").forEach((select) => {
        if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < select.options.length) {
          select.selectedIndex = selectedIndex;
        }
      });
    }
  }

  updateFields(component) {
    const root = this.shadowRoot;
    root.innerHTML = `<style>
      :host{display:block;max-width:100%;font-family:"Open Sauce Sans",system-ui,sans-serif;color:#F2F0E9}
      *{box-sizing:border-box} button,input,select{font:inherit} button{cursor:pointer}
      .tip{display:flex;align-items:center;gap:7px;width:max-content;max-width:100%;padding:7px 11px;background:#F2F0E9;color:#111;border:2px solid #000;border-radius:9px;box-shadow:2px 2px 0 #000;font-size:11px;font-weight:700;line-height:1.3}
      .tip::before{content:"";flex:none;width:8px;height:8px;background:#A78BFA;border:1.5px solid #000;border-radius:50%}
      .panel{width:min(76vw,280px);max-width:100%;padding:13px;background:#15151C;border:2.5px solid #000;border-radius:14px;box-shadow:3px 3px 0 #000}
      h3{margin:0 0 8px;font:700 19px/1.1 "Peace Sans","Arial Black",sans-serif} p{margin:0 0 10px;font-size:13px;line-height:1.35;color:rgba(242,240,233,.8)}
      .actions{display:flex;gap:7px}.actions button,.options button,.submit{min-height:40px;border:2.5px solid #000;border-radius:10px;box-shadow:3px 3px 0 #000;font-size:13px;font-weight:800}
      .actions button{flex:1;padding:6px;background:#F2F0E9;color:#111}.actions button:nth-child(2){background:#1C1C24;color:#F2F0E9}
      .choice{width:min(72vw,260px);max-width:100%;display:grid;gap:8px}.prompt{justify-self:center;max-width:100%;padding:8px 12px;background:#A78BFA;color:#111;border:2.5px solid #000;border-radius:10px;box-shadow:3px 3px 0 #000;font:700 18px/1.15 "Peace Sans","Arial Black",sans-serif;text-align:center}
      .options{display:grid;gap:8px}.options button{padding:8px 10px;background:#F2F0E9;color:#111;text-align:center}
      .form-fields{display:grid;gap:7px;margin:10px 0}.form-fields label{display:grid;gap:4px;font-size:11px;font-weight:700;color:rgba(242,240,233,.7)}.form-fields input,.form-fields select{width:100%;min-height:38px;padding:7px 9px;background:#1C1C24;color:#F2F0E9;border:2px solid rgba(242,240,233,.24);border-radius:8px;font-size:13px}.submit{width:100%;background:#FF2D78;color:#F2F0E9}
      button:active{transform:translate(3px,3px);box-shadow:none}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #FF9FBC;outline-offset:2px}
      @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    </style>`;
    const node = (tag, className, label) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (label != null) el.textContent = String(label);
      return el;
    };
    const addRouteButton = (parent, label, index) => {
      const button = node("button", "", label || "Continue");
      button.type = "button";
      button.dataset.routeIndex = String(index);
      parent.append(button);
    };
    if (component.kind === "tooltip") {
      const tip = node("div", "tip");
      tip.append(node("span", "component-text", component.text || ""));
      root.append(tip);
    } else if (component.kind === "card") {
      const panel = node("div", "panel");
      if (component.title) panel.append(node("h3", "", component.title));
      if (component.text) panel.append(node("p", "", component.text));
      const buttons = component.restyle_capture?.buttons || component.actions || [];
      if (buttons.length) {
        const actions = node("div", "actions");
        buttons.slice(0, 2).forEach((action, index) => addRouteButton(actions, action.label, index));
        panel.append(actions);
      }
      root.append(panel);
    } else if (component.kind === "choice") {
      const choice = node("div", "choice");
      choice.append(node("div", "prompt", component.title || component.text || "Choose"));
      const options = node("div", "options");
      component.options?.slice(0, 4).forEach((option, index) => addRouteButton(options, option.label, index));
      choice.append(options);
      root.append(choice);
    } else if (component.kind === "form") {
      const form = node("form", "panel");
      if (component.title) form.append(node("h3", "", component.title));
      const fields = node("div", "form-fields");
      component.fields?.forEach((field) => {
        const label = node("label", "", field.label || field.name);
        const input = field.type === "choice" ? document.createElement("select") : document.createElement("input");
        input.name = field.name;
        input.required = Boolean(field.required);
        if (input instanceof HTMLInputElement) {
          input.type = field.type === "email" ? "email" : field.type === "number" ? "number" : "text";
          if (field.type === "number") input.step = "any";
        }
        if (input instanceof HTMLSelectElement) {
          field.options?.forEach((option) => {
            const item = document.createElement("option");
            item.value = String(option.value ?? option.label);
            item.textContent = option.label;
            input.append(item);
          });
          if (component.restyle_capture?.form) input.value = "no";
        }
        label.append(input);
        fields.append(label);
      });
      form.append(fields);
      const submit = node("button", "submit", component.submit_label || "Send");
      submit.type = "submit";
      form.append(submit);
      root.append(form);
    }
    applyComponentAppearance(root, component, this.visualUnit);
    if (component.restyle_capture?.font) {
      const style = document.createElement("style");
      style.textContent = `:host,*{font-family:"${fontFamily(component.restyle_capture.font)}"!important}`;
      root.append(style);
    }
  }

  setPending(pending) {
    const form = this.shadowRoot.querySelector("form");
    if (!form) return;
    form.setAttribute("aria-busy", String(Boolean(pending)));
    form.querySelectorAll("input, select, button").forEach(control => { control.disabled = Boolean(pending); });
    const submit = form.querySelector("button[type=submit]");
    if (submit) submit.textContent = pending
      ? this.component.restyle_capture?.form?.waitingLabel || "Sending…"
      : this.component.submit_label || "Send";
  }

  sendAnswer(optionIndex) {
    if (!Number.isInteger(optionIndex)) return;
    this.dispatchEvent(new CustomEvent("pvo-answer", {
      bubbles: true,
      composed: true,
      detail: { componentId: this.componentId, index: optionIndex },
    }));
  }
}

export function registerComponentView() {
  customElements.define("pvo-component-view", PvoComponentView);
}
