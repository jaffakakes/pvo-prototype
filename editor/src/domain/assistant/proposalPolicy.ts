import type { PvoLanguageRule, PvoLanguageSource } from "../../../../packages/pvo-language/index.js";
import { outcomeAction } from "../components/languageSource";

const STYLE_PROPERTIES = new Set([
  "color", "background", "background-color", "border-color", "border-radius",
  "font-size", "font-weight", "text-align",
]);

/** Drop unknown visual keys; the compiler still validates every selector and value. */
export function supportedAssistantStyle(source: PvoLanguageSource) {
  const skipped: string[] = [];
  const style = source.style.replace(/([#\w-]+)\s*\{([^{}]*)\}/g, (rule, selector: string, body: string) => {
    const declarations = body.split(";").map(value => value.trim()).filter(Boolean);
    // Preserve malformed syntax for the compiler to reject, never guess its meaning.
    if (declarations.some(value => !/^[a-z-]+\s*:\s*[^{}]+$/i.test(value))) return rule;
    const supported = declarations.filter(value => {
      const property = value.slice(0, value.indexOf(":")).trim();
      if (STYLE_PROPERTIES.has(property)) return true;
      skipped.push(`“${property}” isn't a supported style.`);
      return false;
    });
    return supported.length === declarations.length ? rule
      : supported.length ? `${selector} { ${supported.join("; ")}; }` : "";
  });
  return { source: { ...source, style }, skipped };
}

export function assistantLogicSource(rules: readonly PvoLanguageRule[]) {
  return rules.map(rule => {
    const event = rule.event === "submit" ? "on submit" : `on ${rule.event}(${rule.target})`;
    return `${event} { ${outcomeAction(rule.action)}; }`;
  }).join("\n");
}

/** Existing authored requests survive visual edits; the assistant cannot author network effects. */
export function supportedAssistantRules(original: readonly PvoLanguageRule[], proposed: readonly PvoLanguageRule[]) {
  const skipped: string[] = [];
  const rules = proposed.flatMap(rule => {
    if (["continue", "time", "scene"].includes(rule.action.kind)) return [rule];
    const before = original.find(value => value.event === rule.event && value.target === rule.target);
    if (before && JSON.stringify(before.action) === JSON.stringify(rule.action)) return [rule];
    skipped.push("Only continue, jump to time and go to scene actions are supported.");
    return before ? [before] : [];
  });
  return { rules, skipped };
}
