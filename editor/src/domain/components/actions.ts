import type { JsonValue, PvoAction } from "../../../../packages/pvo-sdk/index.js";
import type { Outcome, PlaybackOutcome, Scene } from "../project/model";

/** Request targets are fixed HTTP(S) hosts. Templates may change paths/data, never the host. */
export function requestHost(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  }
  catch {
    throw new Error("Enter an absolute HTTP(S) request URL.");
  }
  if (!(["http:", "https:"].includes(url.protocol)) || !url.host || url.username || url.password || /[{}]/.test(url.host)) {
    throw new Error("Enter an absolute HTTP(S) request URL with a fixed host.");
  }
  return url.host.toLowerCase();
}
export function checkedDomains(entries: string[]): string[] {
  const domains = new Set<string>();
  for (const entry of entries) {
    const host = entry.trim().toLowerCase();
    if (!host)
      continue;
    if (!/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:[\da-f:]+)\])(?::\d{1,5})?$/.test(host) || /^(?:https?:\/\/|.*[\/?#@{}])/.test(host)) {
      throw new Error(`Allowed domain “${entry.trim()}” must be a host only, without https:// or a path.`);
    }
    domains.add(host);
  }
  return [...domains];
}
export function requestBody(source: string): JsonValue | undefined {
  if (!source.trim())
    return undefined;
  try {
    return JSON.parse(source) as JsonValue;
  }
  catch {
    throw new Error("Request body must be valid JSON.");
  }
}
export function actionFor(outcome: Outcome | undefined, componentId?: string): PvoAction {
  if (outcome?.kind === "time")
    return { type: "seek", time: outcome.t };
  if (outcome?.kind === "scene")
    return { type: "goto_scene", scene: outcome.sceneId };
  if (outcome?.kind === "request") {
    requestHost(outcome.url);
    return {
      type: "request", url: outcome.url.trim(), method: outcome.method,
      ...(outcome.method === "POST" && outcome.body.trim() ? { body: requestBody(outcome.body) } : {}),
      ...(componentId ? { into: `responses.${componentId}` } : {}),
      on_success: actionFor(outcome.onSuccess),
      ...(outcome.onError ? { on_error: actionFor(outcome.onError) } : {}),
    };
  }
  return { type: "custom", name: "restyle_continue" };
}
export function collectRequestDomains(scenes: Scene[], configuredDomains: string[], includeCompiledLanguage = true): string[] {
  const domains = new Set(checkedDomains(configuredDomains));
  const add = (outcome: Outcome | undefined) => {
    if (outcome?.kind === "request") {
      domains.add(requestHost(outcome.url));
      if (outcome.method === "POST")
        requestBody(outcome.body);
    }
  };
  for (const scene of scenes)
    for (const component of scene.components) {
      if (component.code?.custom) {
        if (!component.code.pvo) {
          throw new Error(`${scene.name} · ${component.type}: this older HTML/CSS/JavaScript component is no longer supported. Reset it to Fields or recreate it in PVO language.`);
        }
        if (includeCompiledLanguage)
          component.code.pvoCompiled?.rules.forEach(rule => add(rule.action));
        continue;
      }
      component.fields.options?.forEach(option => add(option.outcome));
      component.fields.buttons?.forEach(button => add(button.outcome));
      const localForm = component.type === "form" && component.fields.formSubmitMode === "local";
      if (!localForm) add(component.fields.outcome);
      if (component.type === "form" && !localForm && component.fields.formFields && component.fields.destination?.trim()) {
        domains.add(requestHost(component.fields.destination));
      }
    }
  return [...domains];
}
export const isPlaybackOutcome = (outcome: Outcome): outcome is PlaybackOutcome => outcome.kind !== "request";
