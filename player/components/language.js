import { compilePvoComponent } from "../../packages/pvo-language/index.js";

function actionForLanguageOutcome(outcome, componentId) {
  if (outcome.kind === "time") return { type: "seek", time: outcome.t };
  if (outcome.kind === "scene") return { type: "goto_scene", scene: outcome.sceneId };
  if (outcome.kind === "request") return {
    type: "request", url: outcome.url, method: outcome.method,
    ...(outcome.method === "POST" && outcome.body ? { body: JSON.parse(outcome.body) } : {}),
    into: `responses.${componentId}`,
    on_success: actionForLanguageOutcome(outcome.onSuccess, componentId),
    ...(outcome.onError ? { on_error: actionForLanguageOutcome(outcome.onError, componentId) } : {}),
  };
  return { type: "custom", name: "restyle_continue" };
}

function applyLanguageSemantics(component, compiled) {
  const { structure, rules } = compiled;
  const route = (id) => {
    const rule = rules.find((item) => item.target === id);
    if (!rule) throw new Error(`PVO Logic is missing a route for ${id ?? "submit"}.`);
    return rule.action;
  };
  if (structure.type === "tooltip") component.text = structure.text;
  if (structure.type === "card") {
    component.title = structure.title || "";
    component.text = structure.body || "";
    component.actions = structure.buttons.map((button) => ({
      label: button.label, action: actionForLanguageOutcome(route(button.id), component.id),
    }));
    component.restyle_capture.buttons = structure.buttons.map((button) => ({ label: button.label }));
    component.restyle_capture.outcomes = structure.buttons.map((button) => route(button.id));
  }
  if (structure.type === "choice") {
    component.title = structure.prompt;
    component.options = structure.options.map((option) => ({
      label: option.label, action: actionForLanguageOutcome(route(option.id), component.id),
    }));
    component.restyle_capture.outcomes = structure.options.map((option) => route(option.id));
  }
  if (structure.type === "form") {
    const labels = { name: "Name", email: "Email", phone: "Phone", short: "Short text", number: "Number", yesno: "Yes or no" };
    component.title = structure.heading ?? "";
    component.fields = structure.fields.map((field) => ({
      name: field.name, label: field.label ?? labels[field.kind],
      type: field.kind === "email" ? "email" : field.kind === "number" ? "number" : field.kind === "yesno" ? "choice" : "text",
      ...(field.kind === "yesno" ? { options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }] } : {}),
    }));
    component.submit_label = structure.submit;
    component.on_submit = actionForLanguageOutcome(route(null), component.id);
    component.restyle_capture.outcomes = [route(null)];
  }
}

export async function readPvoLanguage(decoded) {
  const byId = new Map(decoded.assets.map((asset) => [asset.id, asset]));
  const sources = new Map();
  await Promise.all((decoded.manifest.components || []).map(async (component) => {
    const code = component.restyle_capture?.code;
    if (!code) return;
    if (!code.language) throw new Error(`Component ${component.id} uses the retired HTML/CSS/JavaScript format. Export it with PVO language.`);
    if (code.language.version !== 1) throw new Error(`Unsupported PVO language version for component ${component.id}.`);
    const source = {};
    for (const part of ["structure", "style", "logic"]) {
      const path = code.language[part];
      const asset = typeof path === "string" ? byId.get(path) : null;
      if (!asset) throw new Error(`PVO ${part} is missing for component ${component.id}.`);
      if (asset.size > 128 * 1024) throw new Error(`PVO ${part} is too large for component ${component.id}.`);
      source[part] = await asset.blob.text();
    }
    const compiled = await compilePvoComponent(component.kind, source);
    if (component.kind === "choice" && compiled.structure.options.length !== 2) {
      throw new Error(`Choice ${component.id} must have exactly two options in this editor.`);
    }
    applyLanguageSemantics(component, compiled);
    sources.set(component.id, { html: compiled.html, css: compiled.css, js: compiled.js, fields: {}, structure: compiled.structure });
  }));
  return sources;
}
