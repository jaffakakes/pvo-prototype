import type { PvoLanguageStructure } from "../../../../packages/pvo-language/index.js";

const COLOURS: Record<string, string> = {
  black: "#15151C", white: "#FFFFFF", cream: "#F2F0E9", pink: "#FF2D78",
  violet: "#A78BFA", purple: "#A78BFA", lavender: "#DCD2F5", blue: "#60A5FA",
  green: "#6EE7B7", red: "#FF5C5C", yellow: "#FFD23E", orange: "#FF9F43",
};

export function assistantTextSelectors(structure: PvoLanguageStructure): string[] {
  if (structure.type === "tooltip") return ["text"];
  if (structure.type === "choice") return ["prompt", "option"];
  if (structure.type === "form") return [...(structure.heading ? ["heading"] : []), "field", "submit"];
  return [structure.title !== null ? "title" : "", structure.body !== null ? "body" : "", structure.buttons.length ? "button" : ""].filter(Boolean);
}

export function assistantHeading(structure: PvoLanguageStructure) {
  if (structure.type === "tooltip") return { selector: "text", size: 13, label: "text" };
  if (structure.type === "choice") return { selector: "prompt", size: 19, label: "heading" };
  if (structure.type === "form") return structure.heading
    ? { selector: "heading", size: 19, label: "heading" }
    : { selector: "submit", size: 12, label: "submit label" };
  return structure.title !== null ? { selector: "title", size: 19, label: "heading" }
    : { selector: "body", size: 11, label: "body text" };
}

function currentSize(style: string, selectors: readonly string[], fallback: number) {
  let size = fallback;
  for (const rule of style.matchAll(/([#\w-]+)\s*\{([^{}]*)\}/g)) {
    // The compiler emits class/attribute selectors with equal specificity, so source order wins.
    if (!selectors.includes(rule[1])) continue;
    for (const declaration of rule[2].matchAll(/\bfont-size\s*:\s*([\d.]+)px\s*;/g)) size = Number(declaration[1]);
  }
  return size;
}

function selectorFor(name: string, structure: PvoLanguageStructure) {
  if (/^(?:heading|title|prompt)$/.test(name)) return assistantHeading(structure).selector;
  if (/^body(?: text)?$/.test(name)) return structure.type === "card" && structure.body !== null ? "body" : null;
  if (/^(?:button|submit(?: label)?)$/.test(name)) {
    if (structure.type === "card") return structure.buttons.length ? "button" : null;
    if (structure.type === "choice") return "option";
    if (structure.type === "form") return "submit";
    return null;
  }
  if (name === "text") return assistantHeading(structure).selector;
  if (name === "background" || name === "border" || !name) return structure.type;
  return null;
}

/** A bounded phrase mapper that can only produce compiler-supported visual declarations. */
export function localStyleRules(words: string, structure: PvoLanguageStructure, style: string): string[] | null {
  const prompt = words.toLowerCase().replace(/[.!]$/, "").trim();
  const phrase = prompt.replace(/^(?:please\s+)?(?:make\s+(?:it\s+|the\s+)?|use\s+|set\s+(?:the\s+)?)?/, "");
  const selectors = assistantTextSelectors(structure);
  if (/^(?:softer|soft)(?: colours| colors)?$/.test(phrase)) {
    return [`${structure.type} { background: #F2F0E9; color: #15151C; border-color: #C9C4DA; }`, ...selectors.map(selector => {
      const control = ["button", "option", "submit", "field"].includes(selector);
      return `${selector} { color: #15151C;${control ? ` background: ${selector === "field" ? "#FFFFFF" : "#DCD2F5"}; border-color: #A9A1BA;` : ""} }`;
    })];
  }
  if (/^(?:dark|darker|light|lighter)(?: theme| colours| colors)?$/.test(phrase)) {
    const light = phrase.startsWith("light");
    const ink = light ? "#15151C" : "#F2F0E9";
    return [`${structure.type} { background: ${light ? "#F2F0E9" : "#15151C"}; color: ${ink}; }`,
      ...selectors.filter(selector => !["button", "option", "submit", "field"].includes(selector)).map(selector => `${selector} { color: ${ink}; }`)];
  }
  if (/^(?:bolder(?: text)?|bold(?: text)?|text bold)$/.test(phrase))
    return selectors.map(selector => `${selector} { font-weight: 900; }`);
  if (/^(?:rounded|rounder|round|square)(?: corners)?$/.test(phrase))
    return [`${structure.type} { border-radius: ${phrase.startsWith("square") ? 0 : 24}px; }`];

  const size = /^(?:(larger|bigger|smaller) (heading|title|prompt|body(?: text)?|button|submit(?: label)?|text)|(heading|title|prompt|body(?: text)?|button|submit(?: label)?|text) (?:to |size )?(larger|bigger|smaller|\d+(?:\.\d+)?(?:px)?))$/.exec(phrase);
  if (size) {
    const selector = selectorFor(size[2] || size[3], structure);
    if (!selector) return null;
    const target = assistantHeading(structure);
    const fallback = selector === target.selector ? target.size : selector === "body" ? 11 : 12;
    const change = size[1] || size[4];
    const inherited = structure.type === "tooltip" ? currentSize(style, ["tooltip"], fallback) : fallback;
    const ids = selector === "button" && structure.type === "card" ? structure.buttons.map(button => button.id)
      : selector === "option" && structure.type === "choice" ? structure.options.map(option => option.id) : [];
    const targets = ids.length ? ids.map(id => `#${id}`) : [selector];
    const sizes = targets.map(selected => {
      const previous = currentSize(style, [selector, selected], inherited);
      const pixels = /^\d/.test(change) ? Number(change.replace(/px$/, ""))
        : Math.max(8, Math.min(72, Math.round(previous * (change === "smaller" ? .8 : 1.25))));
      return { selected, previous, pixels };
    });
    if (sizes.some(value => value.pixels < 8 || value.pixels > 72)) return null;
    if (sizes.every(value => value.previous === value.pixels))
      throw new Error(`The ${target.label} is already at the PVO limit of ${sizes[0].pixels}px.`);
    return sizes.map(value => `${value.selected} { font-size: ${value.pixels}px; }`);
  }

  const colour = /^(?:(heading|title|prompt|body(?: text)?|button|submit(?: label)?|text|background|border)\s+(?:colou?r\s+)?(?:to\s+)?)?(#[a-f\d]{3,8}|black|white|cream|pink|violet|purple|lavender|blue|green|red|yellow|orange)$/.exec(phrase);
  if (!colour) return null;
  const name = colour[1] ?? "";
  const selector = selectorFor(name, structure);
  if (!selector) return null;
  const value = COLOURS[colour[2]] ?? colour[2];
  if (value.startsWith("#") && !/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value)) return null;
  const property = name === "border" ? "border-color" : !name || name === "background" || /^(button|submit)/.test(name) ? "background" : "color";
  return [`${selector} { ${property}: ${value}; }`];
}
