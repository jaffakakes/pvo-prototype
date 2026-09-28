import type { PvoLanguageSource } from "../../../../packages/pvo-language/index.js";

export type AssistantChanges = { style: number; structure: number; logic: number };

function differences(before: Map<string, string>, after: Map<string, string>) {
  return [...new Set([...before.keys(), ...after.keys()])].filter(key => before.get(key) !== after.get(key)).length;
}

function styleValues(source: string) {
  const values = new Map<string, string>();
  for (const rule of source.matchAll(/([#\w-]+)\s*\{([^{}]*)\}/g)) {
    for (const declaration of rule[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      const property = declaration[1] === "background-color" ? "background" : declaration[1];
      values.set(`${rule[1]}:${property}`, declaration[2].trim().replace(/\s+/g, " ").toLowerCase());
    }
  }
  return values;
}

function structureValues(source: string) {
  const values = new Map<string, string>();
  for (const element of source.matchAll(/<(\w+)([^>]*?)\s*\/>|<(\w+)([^>]*)>([^<]*)<\/\3>/g)) {
    const tag = element[1] ?? element[3];
    const attributes = element[2] ?? element[4];
    const id = /\b(?:id|name)="([^"]+)"/.exec(attributes)?.[1] ?? "";
    values.set(`${tag}:${id}`, `${attributes.trim()}|${element[5] ?? ""}`);
  }
  return values;
}

function logicValues(source: string) {
  const values = new Map<string, string>();
  const starts = [...source.matchAll(/\bon\s+(submit|(?:press|choose)\s*\(\s*[\w-]+\s*\))\s*\{/g)];
  for (let index = 0; index < starts.length; index++) {
    const entry = starts[index];
    values.set(entry[1].replace(/\s/g, ""), source.slice(entry.index, starts[index + 1]?.index).replace(/\s+/g, " ").trim());
  }
  return values;
}

/** Count changed controls, visual declarations and event rules against the original proposal target. */
export function assistantChanges(before: PvoLanguageSource, after: PvoLanguageSource): AssistantChanges {
  return {
    style: differences(styleValues(before.style), styleValues(after.style)),
    structure: differences(structureValues(before.structure), structureValues(after.structure)),
    logic: differences(logicValues(before.logic), logicValues(after.logic)),
  };
}
