import type { AnimationEasing } from "../../domain/animation/model";
import styles from "./EasingChips.module.css";

const CHOICES = [
  { value: "linear", label: "Steady", title: "Same speed all the way.", path: "M1.5 10.5 10.5 1.5" },
  { value: "ease-in", label: "Speed up", title: "Starts slow, ends fast.", path: "M1.5 10.5C6.5 10.5 9.5 8 10.5 1.5" },
  { value: "ease-out", label: "Slow down", title: "Starts fast, eases into the next keyframe.", path: "M1.5 10.5C2.5 5 5 1.5 10.5 1.5" },
  { value: "hold", label: "Jump", title: "Holds this value, then snaps to the next keyframe.", path: "M1.5 10.5H6V1.5H10.5" },
] as const;

export function EasingGlyph({ easing }: { easing: AnimationEasing }) {
  const path = CHOICES.find(choice => choice.value === easing)?.path ?? "M1.5 10.5C7 10.5 5 1.5 10.5 1.5";
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d={path} /></svg>;
}

export function EasingChips({ value, onChange, disabled = false, compact = false }: {
  value: AnimationEasing | null; onChange(value: AnimationEasing): void; disabled?: boolean; compact?: boolean;
}) {
  return <div className={styles.chips} data-compact={compact} role="group" aria-label="Easing to next keyframe">
    {CHOICES.map(choice => <button type="button" key={choice.value} title={choice.title} data-keyframe-control
      aria-pressed={value === choice.value} disabled={disabled} onClick={() => onChange(choice.value)}>
      <EasingGlyph easing={choice.value} /><span>{choice.label}</span>
    </button>)}
  </div>;
}
