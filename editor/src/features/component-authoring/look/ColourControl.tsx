import { useRef, useState } from "react";
import { LOOK_PALETTE, normalizeHex } from "../../../domain/components/look";
import { hueColor, hueLightness } from "../../../domain/components/lookColour";
import styles from "./LookTab.module.css";

export function ColourControl({ label, value, customValue, allowNone = false, onChange }: {
  label: string;
  value: string;
  customValue?: string;
  allowNone?: boolean;
  onChange: (value: string, undoable?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  const [hue, lightness] = hueLightness(value);
  const grouped = useRef(false);
  const start = () => { grouped.current = false; };
  const edit = (color: string, syncText = true) => {
    onChange(color, !grouped.current);
    grouped.current = true;
    if (syncText) setHex(color);
  };
  const offPalette = value !== "none" && !LOOK_PALETTE.includes(normalizeHex(value) ?? value);
  return <div className={styles.control}>
    <h4>{label}</h4>
    {customValue && <p data-look-custom-value>Custom · {customValue}</p>}
    <div className={styles.swatches} data-look-swatches>
      {allowNone && <button
        type="button" className={styles.swatch} data-on={value === "none"}
        aria-label={`${label}: none`} title="None" onClick={() => onChange("none")}
      ><span className={styles.none} /></button>}
      {LOOK_PALETTE.map(color => <button
        key={color} type="button" className={styles.swatch}
        data-on={normalizeHex(value) === color} aria-label={`${label}: ${color}`}
        title={color} onClick={() => onChange(color)}
      ><span style={{ background: color }} /></button>)}
      <button type="button" className={styles.custom} data-on={offPalette || open} onClick={() => {
        setHex(value === "none" ? "#FF9FBC" : value);
        setOpen(!open);
      }}>
        {offPalette && <i style={{ background: value }} />}Custom
      </button>
    </div>
    {open && <div className={styles.customPanel}>
      <div className={styles.customTitle}>
        <strong>Custom colour</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label={`Close custom ${label.toLowerCase()}`}>×</button>
      </div>
      <label>Hue<input
        aria-label={`${label} hue`} type="range" min="0" max="360" value={hue}
        onFocus={start} onPointerDown={start} onBlur={start}
        onChange={event => edit(hueColor(Number(event.target.value), lightness))}
      /></label>
      <label>Lightness<input
        aria-label={`${label} lightness`} type="range" min="0" max="100" value={lightness}
        onFocus={start} onPointerDown={start} onBlur={start}
        onChange={event => edit(hueColor(hue, Number(event.target.value)))}
      /></label>
      <label>Hex<input
        aria-label={`${label} hex`} type="text" value={hex} maxLength={7} spellCheck={false}
        onFocus={start} onBlur={() => { setHex(value); start(); }}
        onChange={event => {
          setHex(event.target.value);
          const color = normalizeHex(event.target.value);
          if (color) edit(color, false);
        }}
      /></label>
    </div>}
  </div>;
}
