import type { CSSProperties } from "react";
import { lookStyles } from "../../../../../packages/pvo-component-runtime/index.js";
import { applyComponentPreset, type LookPreset } from "../../../domain/components/look";
import type { PvoComponent } from "../../../domain/project/model";
import styles from "./LookTab.module.css";

/** Non-interactive current wording; browsing a thumbnail can never dispatch a viewer action. */
export function LookPreview({ component, preset, scale = .42 }: { component: PvoComponent; preset: LookPreset; scale?: number }) {
  const appearance = lookStyles(applyComponentPreset(component, preset), scale);
  const fields = component.fields;
  const buttons = component.type === "choice" ? fields.options : component.type === "card" ? fields.buttons : component.type === "form" ? [{ label: fields.submitLabel || "Send" }] : [];
  const heading = component.type === "choice" ? fields.prompt : component.type === "form" ? fields.heading : fields.title;
  return <span className={styles.preview} aria-hidden="true">
    <span className={styles.previewPanel} style={appearance.whole as CSSProperties}>
      {heading && <span style={appearance.heading as CSSProperties}>{heading}</span>}
      {component.type === "tooltip" && <span style={appearance.body as CSSProperties}>{fields.text}</span>}
      {component.type === "card" && <span style={appearance.body as CSSProperties}>{fields.body}</span>}
      {component.type === "form" && <span className={styles.previewField} style={appearance.field as CSSProperties}>Your answer</span>}
      {buttons?.map((button, index) => <span key={index} className={styles.previewButton} style={appearance.buttons[index] as CSSProperties}>{button.label}</span>)}
    </span>
  </span>;
}
