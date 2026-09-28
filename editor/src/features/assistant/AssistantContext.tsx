import type { CSSProperties } from "react";
import { componentLook } from "../../domain/components/look";
import type { PvoComponent } from "../../domain/project/model";
import { fmt } from "../../ui/formatTime";
import styles from "./AssistantContext.module.css";

function thumbnailColour(value: string | undefined, fallback: string) {
  // Source may contain a draft that has not compiled. Never mount URLs or raw CSS.
  if (value && /^(?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|transparent|currentcolor|black|white)$/i.test(value)) return value;
  if (value && /^rgba?\(\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.%]+(?:\s*,\s*[\d.]+)?\s*\)$/i.test(value)) return value;
  return fallback === "none" ? "transparent" : fallback;
}

/** A tiny visual cue, using authored colours without mounting another runtime. */
function thumbnailStyle(component: PvoComponent): CSSProperties {
  const look = componentLook(component);
  const source = component.code?.custom ? component.code.pvo?.style ?? "" : "";
  const valuesFor = (...selectors: string[]) => {
    const values = new Map<string, string>();
    // The compiler gives tag and ID selectors equal specificity: last rule wins.
    for (const rule of source.matchAll(/([#\w-]+)\s*\{([^{}]*)\}/g)) {
      if (!selectors.includes(rule[1])) continue;
      for (const declaration of rule[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
        const property = declaration[1] === "background-color" ? "background" : declaration[1];
        values.set(property, declaration[2].trim());
      }
    }
    return values;
  };
  const root = valuesFor(component.type);
  const structure = component.code?.pvoCompiled?.structure;
  const buttonId = structure?.type === "card" ? structure.buttons[0]?.id
    : structure?.type === "choice" ? structure.options[0]?.id : undefined;
  const button = valuesFor(component.type === "form" ? "submit" : component.type === "choice" ? "option" : "button", `#${buttonId ?? "button0"}`);
  const authoredRadius = root.get("border-radius") ?? "";
  const radius = /^\d+(?:\.\d+)?px$/.test(authoredRadius) ? Math.min(64, Number.parseFloat(authoredRadius)) : look.whole.radius;
  return {
    background: thumbnailColour(root.get("background"), look.whole.bg),
    color: thumbnailColour(root.get("color"), look.whole.text),
    borderColor: thumbnailColour(root.get("border-color"), look.whole.border),
    borderRadius: Math.min(7, radius / 3),
    "--mini-button": thumbnailColour(button.get("background"), look.btns[0]?.fill ?? look.heading.color),
  } as CSSProperties;
}

export function AssistantContext({ component }: {
  component: PvoComponent;
}) {
  const name = component.type[0].toUpperCase() + component.type.slice(1);
  return <div className={styles.context} data-assistant-context>
    <span className={styles.mini} style={thumbnailStyle(component)} data-assistant-context-preview aria-hidden="true">
      <i /><i /><b />
    </span>
    <span className={styles.description}>
      <strong>{name} · {fmt(component.at)}</strong>
      <span>what you type changes this one</span>
    </span>
  </div>;
}
