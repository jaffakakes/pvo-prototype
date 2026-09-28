const ACTION_TYPES = new Set([
  "show",
  "hide",
  "set",
  "goto_scene",
  "seek",
  "request",
  "open_url",
  "chain",
  "branch",
  "custom",
]);

export function validateActions(actions, path, errors, warnings, ids) {
  if (actions == null) return;
  const list = Array.isArray(actions) ? actions : [actions];
  list.forEach((action, index) => {
    const at = `${path}[${index}]`;
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      errors.push(`${at} must be an action object.`);
      return;
    }
    if (!ACTION_TYPES.has(action.type)) {
      errors.push(`${at}.type must be one of: ${[...ACTION_TYPES].join(", ")}.`);
      return;
    }
    if ((action.type === "show" || action.type === "hide") && typeof action.component === "string" && !ids.components.has(action.component)) {
      errors.push(`${at} references missing component "${action.component}".`);
    }
    if ((action.type === "show" || action.type === "hide") && !action.component) {
      errors.push(`${at}.component is required.`);
    }
    if (action.type === "set" && typeof action.key !== "string") errors.push(`${at}.key is required.`);
    if (action.type === "goto_scene" && !ids.scenes.has(action.scene)) {
      errors.push(`${at} references missing scene "${action.scene}".`);
    }
    if (action.type === "seek" && action.scene && !ids.scenes.has(action.scene)) {
      errors.push(`${at} references missing scene "${action.scene}".`);
    }
    if (action.type === "seek" && !action.scene && !Number.isFinite(action.time)) errors.push(`${at} needs a scene or numeric time.`);
    if (action.type === "request" && (typeof action.url !== "string" || !/^https?:\/\//i.test(action.url))) errors.push(`${at}.url must be an absolute HTTP(S) URL.`);
    if (action.type === "open_url" && (typeof action.url !== "string" || !/^https?:\/\//i.test(action.url))) errors.push(`${at}.url must be an absolute HTTP(S) URL.`);
    if (action.type === "custom" && typeof action.name !== "string") errors.push(`${at}.name is required.`);
    if (action.type === "custom" && action.into != null && typeof action.into !== "string") errors.push(`${at}.into must be a state path.`);
    if (action.type === "chain" && !Array.isArray(action.actions)) errors.push(`${at}.actions must be an array.`);
    if (action.type === "chain") validateActions(action.actions, `${at}.actions`, errors, warnings, ids);
    if (action.type === "branch") {
      if (!Array.isArray(action.cases) || action.cases.length === 0) errors.push(`${at}.cases must contain at least one case.`);
      (action.cases || []).forEach((branchCase, caseIndex) => {
        if (!branchCase?.when) errors.push(`${at}.cases[${caseIndex}].when is required.`);
        validateActions(branchCase?.then, `${at}.cases[${caseIndex}].then`, errors, warnings, ids);
      });
      validateActions(action.else, `${at}.else`, errors, warnings, ids);
    }
    if (action.type === "request") {
      validateActions(action.on_success, `${at}.on_success`, errors, warnings, ids);
      validateActions(action.on_error, `${at}.on_error`, errors, warnings, ids);
    }
  });
}
