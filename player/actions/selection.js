/** The same control selects its SDK action during connection admission and dispatch. */
export function componentAction(component, index) {
  if (component.kind === "choice")
    return (
      component.options?.[index]?.actions || component.options?.[index]?.action
    );
  if (component.kind === "card") {
    const control = component.actions?.[index];
    return control?.actions || control?.action;
  }
  if (component.kind === "form" && index === 0) return component.on_submit;
  return null;
}
