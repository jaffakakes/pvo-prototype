const originalLabels = new WeakMap();
const originalDisabled = new WeakMap();

/** Host-controlled feedback for a sandboxed form; never starts an action. */
export function setRenderedFormPending(root, pending) {
  if (!root) return;
  root.querySelectorAll("form").forEach(form => {
    form.setAttribute("aria-busy", String(Boolean(pending)));
    form.querySelectorAll("button,input,select,textarea").forEach(control => {
      if (pending) {
        if (!originalDisabled.has(control)) originalDisabled.set(control, control.disabled);
        control.disabled = true;
      } else if (originalDisabled.has(control)) {
        control.disabled = originalDisabled.get(control);
        originalDisabled.delete(control);
      }
    });
    form.querySelectorAll('button[type="submit"]').forEach(button => {
      if (pending) {
        if (!originalLabels.has(button)) originalLabels.set(button, button.textContent);
        button.textContent = button.getAttribute("data-pvo-waiting") || "Sending…";
      } else if (originalLabels.has(button)) {
        button.textContent = originalLabels.get(button);
        originalLabels.delete(button);
      }
    });
  });
}
