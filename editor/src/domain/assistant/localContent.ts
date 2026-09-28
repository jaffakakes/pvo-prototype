import type { PvoLanguageRule, PvoLanguageSource, PvoLanguageStructure } from "../../../../packages/pvo-language/index.js";
import { escapeStructureText } from "../components/languageSource";
import { assistantLogicSource } from "./proposalPolicy";

export type LocalContent = { source: PvoLanguageSource; structure: PvoLanguageStructure; rules: PvoLanguageRule[] };

function replaceText(source: string, tag: string, words: string, index = 0) {
  let seen = 0;
  return source.replace(new RegExp(`(<${tag}(?:\\s[^>]*|)>)[\\s\\S]*?(</${tag}>)`, "g"), (match, open: string, close: string) =>
    seen++ === index ? `${open}${escapeStructureText(words)}${close}` : match);
}

function controls(structure: PvoLanguageStructure): Array<{ event: PvoLanguageRule["event"]; target: string | null }> {
  if (structure.type === "card") return structure.buttons.map(button => ({ event: "press", target: button.id }));
  if (structure.type === "choice") return structure.options.map(option => ({ event: "choose", target: option.id }));
  if (structure.type === "form") return [{ event: "submit", target: null }];
  return [];
}

function parseRoute(words: string): PvoLanguageRule["action"] | null {
  if (/^continue(?: playback)?$/i.test(words)) return { kind: "continue" };
  const jump = /^jump (?:to )?(\d+)(?::([0-5]\d)(?:\.(\d+))?|(?:\.(\d+))?\s*(?:s|seconds)?)$/i.exec(words);
  if (jump) {
    const seconds = jump[2] === undefined ? Number(`${jump[1]}.${jump[4] ?? "0"}`)
      : Number(jump[1]) * 60 + Number(`${jump[2]}.${jump[3] ?? "0"}`);
    return { kind: "time", t: seconds };
  }
  const scene = /^go to scene\s+(?:"([^"]+)"|'([^']+)'|([\w-]+))$/i.exec(words);
  return scene ? { kind: "scene", sceneId: scene[1] ?? scene[2] ?? scene[3] } : null;
}

/** Content and route phrases use only existing controls or the supported Card button shape. */
export function localContentChange(words: string, current: LocalContent): LocalContent | null {
  const phrase = words.trim().replace(/[.!]$/, "");
  const structure = structuredClone(current.structure);
  const source = { ...current.source };
  const rename = /^(?:(?:change|set|rename) (?:the )?)?(heading|title|body|text|prompt|(?:first |second )?button|submit(?: label)?|(?:first |second )?option)(?: (?:text|wording|label))? (?:to |say |says |reads )?["“]([^"”]+)["”]$/i.exec(phrase);
  if (rename) {
    const name = rename[1].toLowerCase();
    const value = rename[2];
    const index = name.startsWith("second ") ? 1 : 0;
    let tag: string | null = null;
    if (structure.type === "tooltip" && /^(text|body|heading|title)$/.test(name)) {
      tag = "text"; structure.text = value;
    } else if (structure.type === "card") {
      if (/^(title|heading)$/.test(name) && structure.title !== null) { tag = "title"; structure.title = value; }
      if (/^(body|text)$/.test(name) && structure.body !== null) { tag = "body"; structure.body = value; }
      if (name.endsWith("button") && structure.buttons[index]) { tag = "button"; structure.buttons[index].label = value; }
    } else if (structure.type === "choice") {
      if (/^(heading|title|prompt)$/.test(name)) { tag = "prompt"; structure.prompt = value; }
      if (/^(?:(?:first|second) )?(option|button)$/.test(name) && structure.options[index]) {
        tag = "option"; structure.options[index].label = value;
      }
    } else if (structure.type === "form") {
      if (/^(submit(?: label)?|button)$/.test(name)) { tag = "submit"; structure.submit = value; }
      if (/^(heading|title)$/.test(name) && structure.heading) { tag = "heading"; structure.heading = value; }
    }
    if (!tag) return null;
    source.structure = replaceText(source.structure, tag, value, index);
    return { ...current, source, structure };
  }

  const add = /^add (?:a )?button(?: (?:called|labelled|labeled))? ["“]([^"”]+)["”]$/i.exec(phrase);
  if (add && structure.type === "card" && structure.buttons.length < 2) {
    let index = 0;
    while (structure.buttons.some(button => button.id === `button${index}`)) index++;
    const id = `button${index}`;
    structure.buttons.push({ id, label: add[1] });
    source.structure = source.structure.replace(/<\/card>\s*$/, `  <button id="${id}">${escapeStructureText(add[1])}</button>\n</card>`);
    const rules: PvoLanguageRule[] = [...current.rules, { event: "press", target: id, action: { kind: "continue" } }];
    source.logic = assistantLogicSource(rules);
    return { source, structure, rules };
  }

  const routed = /^(?:(?:make |set )?(?:the )?(first |second )?(?:button|option|submit) (?:to )?)?(continue(?: playback)?|jump .+|go to scene .+)$/i.exec(phrase);
  if (!routed) return null;
  const action = parseRoute(routed[2]);
  if (!action) return null;
  let targets = controls(structure);
  if (routed[1]) targets = targets.slice(routed[1].toLowerCase() === "second " ? 1 : 0, routed[1].toLowerCase() === "second " ? 2 : 1);
  if (!targets.length) return null;
  const rules = current.rules.filter(rule => !targets.some(target => target.event === rule.event && target.target === rule.target));
  rules.push(...targets.map(target => ({ ...target, action })));
  source.logic = assistantLogicSource(rules);
  return { source, structure, rules };
}
