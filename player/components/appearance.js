import { lookStyles } from "../../packages/pvo-component-runtime/index.js";

/** Apply the same bounded visual values as the editor without accepting arbitrary CSS. */
export function applyComponentAppearance(root, component, unit = 1) {
  const look = component.restyle_capture?.look;
  const whole = root.querySelector(".tip, .panel, .choice");
  if (!whole) return;
  Object.assign(whole.style, {
    width: component.kind === "tooltip" ? "max-content" : `${(component.kind === "choice" ? 176 : 190) * unit}px`,
    maxWidth: "none",
  });
  if (!look) return;
  const buttons = [...root.querySelectorAll("button")];
  const styles = lookStyles(look, unit, buttons.length);
  Object.assign(whole.style, styles.whole);
  root.querySelectorAll("h3, .prompt").forEach(element => Object.assign(element.style, styles.heading));
  root.querySelectorAll("p, .component-text, .form-fields").forEach(element => Object.assign(element.style, styles.body));
  root.querySelectorAll(".form-fields label").forEach(element => Object.assign(element.style, { color: styles.body.color, fontSize: styles.body.fontSize, fontWeight: styles.body.fontWeight, textAlign: styles.body.textAlign }));
  root.querySelectorAll("input, select, textarea").forEach(element => Object.assign(element.style, styles.field));
  buttons.forEach((button, index) => Object.assign(button.style, styles.buttons[index]));
  if (component.kind === "tooltip") {
    const style = document.createElement("style");
    style.textContent = ".tip::before{display:none}";
    root.append(style);
  }
}
