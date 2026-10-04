function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  template.content
    .querySelectorAll("script, iframe, object, embed, link, meta")
    .forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if (
        ["href", "src"].includes(name) &&
        /^javascript:/i.test(attribute.value)
      )
        node.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function sanitizeCss(css) {
  return String(css || "")
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\([^)]*\)/gi, "none");
}

/** Render the manifest's native HTML controls; generated PVO uses the separate sandbox renderer. */
export function renderManifestComponent(root, component, selectedIndex) {
  root.innerHTML = `<style>
    :host { display: block; width: 100%; height: 100%; }
    * { box-sizing: border-box; }
    .component-root { width: 100%; height: 100%; }
    ${sanitizeCss(component.css)}
  </style><div class="component-root">${sanitizeHtml(component.html)}</div>`;
  if (component.kind === "choice" || component.kind === "card") {
    const count =
      component.kind === "choice"
        ? component.options?.length
        : component.actions?.length;
    const buttons = root.querySelectorAll("button");
    buttons.forEach((button, index) => {
      if (index >= count) return;
      button.dataset.optionIndex = String(index);
      button.setAttribute("aria-pressed", String(index === selectedIndex));
      button.toggleAttribute("data-selected", index === selectedIndex);
    });
    root
      .querySelectorAll('input[type="radio"], input[type="checkbox"]')
      .forEach((input, index) => {
        if (index >= count) return;
        input.dataset.optionIndex = String(index);
        input.checked = index === selectedIndex;
      });
    root.querySelectorAll("select").forEach((select) => {
      if (
        Number.isInteger(selectedIndex) &&
        selectedIndex >= 0 &&
        selectedIndex < select.options.length
      ) {
        select.selectedIndex = selectedIndex;
      }
    });
  }
}
