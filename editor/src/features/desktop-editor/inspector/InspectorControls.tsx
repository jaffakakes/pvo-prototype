import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import { Icon } from "../../../ui/Icon";
import styles from "./Inspector.module.css";

export type InspectorControl =
  | { kind: "slider"; label: string; value: number; min: number; max: number; step: number; unit: string; digits?: number; onChange: (value: number, undoable: boolean) => void }
  | { kind: "toggle"; label: string; on: boolean; onToggle: () => void }
  | { kind: "chips"; label?: string; options: string[]; value: string; onPick: (value: string) => void }
  | { kind: "field"; label: string; value: string; max: number; placeholder?: string; onChange: (value: string, undoable: boolean) => void }
  | { kind: "tiles"; label?: string; columns: number; items: { label: string; glyph: ReactNode; selected: boolean; onPick: () => void }[] }
  | { kind: "note"; text: string }
  | { kind: "list"; rows: { label: string; value: string }[] }
  | { kind: "link"; label: string; onClick: () => void };

export type InspectorSection = { title: string; controls: InspectorControl[]; onReset?: () => void };

function InspectorSlider({ control }: { control: Extract<InspectorControl, { kind: "slider" }> }) {
  const edited = useRef(false);
  const fill = (control.value - control.min) / (control.max - control.min) * 100;
  return <label className={styles.slider}>
    <span>{control.label}<output>{control.value.toFixed(control.digits ?? 0)}{control.unit}</output></span>
    <input type="range" aria-label={control.label} min={control.min} max={control.max}
      step={control.step} value={control.value} style={{ "--range-fill": `${fill}%` } as CSSProperties}
      onPointerDown={() => { edited.current = false; }}
      onFocus={() => { edited.current = false; }}
      onBlur={() => { edited.current = false; }}
      onKeyUp={() => { edited.current = false; }}
      onChange={event => {
        control.onChange(Number(event.target.value), !edited.current);
        edited.current = true;
      }} />
  </label>;
}

function InspectorField({ control }: { control: Extract<InspectorControl, { kind: "field" }> }) {
  const id = useId();
  const edited = useRef(false);
  return <div className={styles.field}>
    <label htmlFor={id}>{control.label}<span>{control.value.length}/{control.max}</span></label>
    <input id={id} value={control.value} maxLength={control.max} placeholder={control.placeholder}
      onFocus={() => { edited.current = false; }}
      onBlur={() => { edited.current = false; }}
      onChange={event => {
        control.onChange(event.target.value, !edited.current);
        edited.current = true;
      }} />
  </div>;
}

function Control({ control }: { control: InspectorControl }) {
  switch (control.kind) {
    case "slider": return <InspectorSlider control={control} />;
    case "field": return <InspectorField control={control} />;
    case "note": return <p className={styles.note}>{control.text}</p>;
    case "link": return <button className={styles.link} type="button" onClick={control.onClick}>{control.label}</button>;
    case "toggle": return <div className={styles.toggleRow}>
      <span>{control.label}</span>
      <button className={styles.toggle} type="button" role="switch" aria-label={control.label}
        aria-checked={control.on} onClick={control.onToggle}><span /></button>
    </div>;
    case "chips": return <div className={styles.control}>
      {control.label && <h4>{control.label}</h4>}
      <div className={styles.chips}>{control.options.map(option => <button type="button" key={option}
        aria-pressed={control.value === option} onClick={() => control.onPick(option)}>{option}</button>)}</div>
    </div>;
    case "tiles": return <div className={styles.control}>
      {control.label && <h4>{control.label}</h4>}
      <div className={styles.tiles} style={{ gridTemplateColumns: `repeat(${control.columns}, minmax(0, 1fr))` }}>
        {control.items.map(item => <button className={styles.tile} type="button" key={item.label}
          aria-pressed={item.selected} onClick={item.onPick}>{item.glyph}<span>{item.label}</span></button>)}
      </div>
    </div>;
    case "list": return <dl className={styles.list}>{control.rows.map(row => <div key={row.label}>
      <dt>{row.label}</dt><dd>{row.value}</dd>
    </div>)}</dl>;
  }
}

export function InspectorSections({ sections }: { sections: InspectorSection[] }) {
  return <>{sections.map(section => <section className={styles.section} key={section.title}>
    <div className={styles.sectionHeading}><h3>{section.title}</h3>
      {section.onReset && <button className={styles.reset} type="button" aria-label={`Reset ${section.title.toLowerCase()}`}
        onClick={section.onReset}><Icon name="reset" size={14} /></button>}
    </div>
    {section.controls.map((control, index) => <Control key={`${control.kind}-${index}`} control={control} />)}
  </section>)}</>;
}
