import { LOOK_SIZES, normalizeLook, type ComponentLook } from "../../../../packages/pvo-component-runtime/index.js";
import type { PvoComponent } from "../project/model";
import { authoredLookSource, lookButtonCount, lookStyleSource, projectLookValues, type LookValuePath } from "./languageLookValues";
import { patchLookStyle, readLookStyle, validStyleValue, type StyleChange, type StyleProperty } from "./languageLookStyle";

export type { LookValuePath, LookCustomValues } from "./languageLookValues";

export function projectComponentLook(component: PvoComponent): ComponentLook {
  return projectLookValues(component).look;
}

export function componentLookCustomValues(component: PvoComponent) {
  return projectLookValues(component).custom;
}

function lookEntries(look: ComponentLook): Map<LookValuePath, string | number> {
  const entries = new Map<LookValuePath, string | number>();
  for (const part of ["whole", "heading", "body"] as const)
    for (const [key, value] of Object.entries(look[part])) entries.set(`${part}.${key}` as LookValuePath, value);
  look.btns.forEach((button, index) => {
    for (const [key, value] of Object.entries(button)) entries.set(`btns.${index}.${key}` as LookValuePath, value);
  });
  return entries;
}

function styleChange(component: PvoComponent, look: ComponentLook, path: LookValuePath): StyleChange | null {
  const parts = path.split(".");
  const part = parts[0];
  const name = parts.at(-1)!;
  const index = part === "btns" ? Number(parts[1]) : -1;
  const structure = component.code?.pvoCompiled?.structure;
  let selector = component.type as string;
  if (part === "heading") {
    if (component.type === "tooltip") return null;
    selector = component.type === "card" ? "title" : component.type === "choice" ? "prompt" : "heading";
  } else if (part === "body") {
    if (component.type === "choice") return null;
    selector = component.type === "tooltip" ? "text" : component.type === "form" ? "field" : "body";
  } else if (part === "btns") {
    if (!look.btns[index]) return null;
    if (component.type === "form") selector = "submit";
    else {
      const id = structure?.type === "card" ? structure.buttons[index]?.id
        : structure?.type === "choice" ? structure.options[index]?.id : undefined;
      if (!id) return null;
      selector = `#${id}`;
    }
  }
  const properties: Record<string, StyleProperty> = {
    bg: "background", fill: "background", border: "border-color", text: "color", color: "color",
    radius: "border-radius", align: "text-align", size: "font-size", weight: "font-weight",
  };
  const property = properties[name];
  const raw = lookEntries(look).get(path);
  if (!property || raw === undefined) return null;
  let value = raw === "none" ? "transparent" : String(raw);
  if (name === "size") {
    const size = part === "btns" ? look.btns[index].size : part === "heading" ? look.heading.size : look.body.size;
    value = `${LOOK_SIZES[part === "btns" ? "button" : part === "heading" ? "heading" : "body"][size]}px`;
  }
  if (name === "radius") value = `${Math.min(Number(raw), part === "btns" ? LOOK_SIZES.height[look.btns[index].size] / 2 : 64)}px`;
  if (!validStyleValue(property, value)) throw new Error("Choose a supported component appearance value.");
  return { selector, property, value };
}

/** Update a selected visual property without rebuilding unrelated authored values. */
export function editComponentLook(component: PvoComponent, nextLook: ComponentLook, options: {
  properties?: readonly LookValuePath[];
  replace?: boolean;
} = {}): Pick<PvoComponent, "look" | "code"> {
  const unchanged = { look: component.look, code: component.code };
  const code = component.code;
  // Never overwrite a pending source draft with its last valid projection.
  if (code?.pvoTouched || (code?.custom && !code.pvoCompiled)) return unchanged;
  if (!code?.custom) {
    const look = normalizeLook(nextLook, lookButtonCount(component));
    return { look, code: code?.pvo ? { ...code, pvo: { ...code.pvo, style: lookStyleSource(component, look) } } : code };
  }
  const authored = authoredLookSource(component);
  if (!authored || !code.pvo) return unchanged;
  const previous = projectComponentLook(component);
  const before = lookEntries(previous);
  const after = lookEntries(nextLook);
  const paths = [...new Set([...after.keys()].filter(path => before.get(path) !== after.get(path)).concat(options.properties ?? []))];
  if (!paths.length && !options.replace) return unchanged;
  const changes = paths.map(path => styleChange(component, nextLook, path)).filter((change): change is StyleChange => change !== null);
  if (!changes.length && !options.replace) return unchanged;
  const style = options.replace ? lookStyleSource(component, nextLook) : patchLookStyle(authored.source.style, authored.rules, changes);
  if (!readLookStyle(style, authored.structure)) throw new Error("This appearance edit exceeds the supported PVO Style limits.");
  const source = { ...code.pvo, style };
  const previousValid = code.pvoLastValid;
  const lastValid = previousValid && previousValid.structure === source.structure && previousValid.logic === source.logic
    ? { ...previousValid, style } : previousValid;
  const next = { ...component, look: { ...nextLook, preset: options.replace ? nextLook.preset : "custom" as const }, code: {
    ...code, pvo: source, pvoLastValid: lastValid, pvoLiteral: true, pvoTouched: false,
  } };
  return { look: projectComponentLook(next), code: next.code };
}
