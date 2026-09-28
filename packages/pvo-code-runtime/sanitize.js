import { substituteFieldTokens } from "./field-tokens.js";
import { parseHandler } from "./handlers.js";

const TAGS = new Set([
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "small",
  "br",
  "ul",
  "ol",
  "li",
  "button",
  "form",
  "label",
  "input",
  "textarea",
  "select",
  "option",
]);
const VOID_TAGS = new Set(["br", "input"]);
const INPUT_TYPES = new Set([
  "text",
  "email",
  "tel",
  "number",
  "checkbox",
  "radio",
]);
const BUTTON_TYPES = new Set(["button", "submit", "reset"]);

export function sanitizeMarkup(html, fields, onError) {
  // Template content does not activate scripts or load embedded resources.
  const source = document.createElement("template");
  source.innerHTML = substituteFieldTokens(html, fields);
  const fragment = document.createDocumentFragment();
  const handlers = new Map();
  let nodes = 0;
  const copy = (node, target, depth) => {
    if (++nodes > 600 || depth > 24)
      throw new Error("Component markup is too complex.");
    if (node.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(node.textContent ?? ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.localName?.toLowerCase();
    if (!TAGS.has(tag) || node.namespaceURI !== "http://www.w3.org/1999/xhtml")
      return;
    const safe = document.createElement(tag);
    for (const attr of node.attributes) {
      const key = attr.name.toLowerCase();
      const value = attr.value.slice(0, 500);
      if (key === "onclick" || key === "onsubmit") {
        if ((key === "onsubmit") !== (tag === "form")) continue;
        try {
          const id = String(handlers.size + 1);
          handlers.set(id, parseHandler(value));
          safe.setAttribute(
            `data-pvo-${key === "onclick" ? "click" : "submit"}`,
            id,
          );
        } catch (error) {
          onError(error.message);
        }
      } else if (
        key === "id" ||
        key === "class" ||
        key === "title" ||
        key === "role" ||
        key === "name" ||
        key === "placeholder" ||
        key === "value" ||
        key === "for" ||
        key.startsWith("aria-")
      ) {
        safe.setAttribute(key, value);
      } else if (
        key === "data-pvo-id" &&
        /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)
      ) {
        // Compiler-created local IDs let PVO Style target a control without
        // exposing a browser event or a global document selector.
        safe.setAttribute(key, value);
      } else if (key === "data-pvo-waiting" && tag === "button") {
        safe.setAttribute(key, value);
      } else if (
        key === "type" &&
        tag === "input" &&
        INPUT_TYPES.has(value.toLowerCase())
      ) {
        safe.setAttribute(key, value.toLowerCase());
      } else if (
        key === "type" &&
        tag === "button" &&
        BUTTON_TYPES.has(value.toLowerCase())
      ) {
        safe.setAttribute(key, value.toLowerCase());
      } else if (
        (key === "required" ||
          key === "checked" ||
          key === "disabled" ||
          key === "multiple") &&
        (tag === "input" || tag === "select" || tag === "textarea")
      ) {
        safe.setAttribute(key, "");
      } else if (
        (key === "min" ||
          key === "max" ||
          key === "step" ||
          key === "maxlength") &&
        tag === "input" &&
        (/^\d+(?:\.\d+)?$/.test(value) || (key === "step" && value === "any"))
      ) {
        safe.setAttribute(key, value);
      }
    }
    if (
      tag === "input" &&
      !INPUT_TYPES.has((safe.getAttribute("type") || "text").toLowerCase())
    )
      safe.setAttribute("type", "text");
    if (tag === "button" && !safe.hasAttribute("type"))
      safe.setAttribute("type", "button");
    if (tag === "form") safe.setAttribute("autocomplete", "off");
    target.appendChild(safe);
    if (!VOID_TAGS.has(tag))
      for (const child of node.childNodes) copy(child, safe, depth + 1);
  };
  for (const child of source.content.childNodes) copy(child, fragment, 0);
  return { fragment, handlers };
}

export function sanitizeCss(css) {
  if (!css.trim()) return "";
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const rules = [];
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSStyleRule)) continue; // no @import, @font-face, nesting or resource at-rules
    const declarations = [];
    for (const name of rule.style) {
      const value = rule.style.getPropertyValue(name);
      if (
        /url\s*\(|image-set\s*\(|@import|\\/i.test(value) ||
        /^-(?:moz-binding|webkit-user-modify)$/i.test(name)
      )
        continue;
      declarations.push(
        `${name}:${value}${rule.style.getPropertyPriority(name) ? "!important" : ""}`,
      );
    }
    if (declarations.length)
      rules.push(`${rule.selectorText}{${declarations.join(";")}}`);
  }
  return rules.join("\n");
}
