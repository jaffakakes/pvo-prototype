import { TEXT_FONTS, TEXT_PRESETS, textStyle, type TextStyle } from "../../../../../packages/pvo-text-runtime/index.js";
import type { TextOverlay } from "../../../domain/project/model";
import { dragTextTiming } from "../../../domain/text/timing";
import { useCapture } from "../../../state/captureStore";
import { fmt } from "../../../ui/formatTime";
import { InspectorSections, type InspectorSection } from "./InspectorControls";
import styles from "./Inspector.module.css";

const SIZES = { S: 16, M: 21, L: 28 };
const POSITIONS = { Top: 16, Middle: 50, Bottom: 80 };

export function TextInspector({ text, tab }: { text: TextOverlay; tab: string }) {
  const t = useCapture(state => state.t);
  const appearance = textStyle(text);
  const change = (changes: Partial<TextOverlay>, undoable = true) => useCapture.getState().updateText(text.id, changes, undoable);
  const restyle = (changes: Partial<TextStyle>) => change({ style: { ...appearance, ...changes } });
  if (tab === "Text") return <>
    <InspectorSections sections={[{ title: "Text", controls: [{ kind: "field", label: "Text", value: text.text,
      max: Math.max(40, text.text.length), placeholder: "Your text", onChange: (value, undoable) => change({ text: value }, undoable) }] }]} />
    <section className={styles.section}>
      <h3>Timing</h3>
      <div className={styles.appears}>
        <span>Appears at</span>
        <div><strong>{fmt(text.start)}</strong><button type="button" onClick={() => {
          const state = useCapture.getState();
          change(dragTextTiming(text, "move", state.t - text.start));
        }}>Use {fmt(t)}</button></div>
        <p className={styles.note}>Shows for {(text.end - text.start).toFixed(1)}s. Drag its edges on the timeline to trim.</p>
      </div>
    </section>
  </>;
  const sections: InspectorSection[] = [{ title: "Style", controls: [
    { kind: "tiles", columns: 3, items: TEXT_PRESETS.map(preset => ({
      label: preset.name,
      selected: (Object.keys(preset.style) as (keyof TextStyle)[]).every(key => appearance[key] === preset.style[key]),
      glyph: <span className={styles.textSample} style={{
        fontFamily: TEXT_FONTS[preset.style.font], fontWeight: preset.style.bold ? 800 : 500,
        fontStyle: preset.style.italic ? "italic" : "normal", color: preset.style.fill,
        background: preset.style.background, WebkitTextStroke: preset.style.strokeWidth ? ".6px #000" : undefined,
        textShadow: preset.style.shadow ? "2px 2px 0 #000" : undefined,
      }}>Aa</span>,
      onPick: () => restyle(preset.style),
    })) },
    { kind: "chips", label: "Size", options: Object.keys(SIZES),
      value: Object.entries(SIZES).find(([, size]) => size === appearance.size)?.[0] ?? "",
      onPick: value => restyle({ size: SIZES[value as keyof typeof SIZES] }) },
    { kind: "chips", label: "Vertical preset", options: Object.keys(POSITIONS),
      value: Object.entries(POSITIONS).find(([, y]) => y === text.y)?.[0] ?? "",
      onPick: value => change({ y: POSITIONS[value as keyof typeof POSITIONS] }) },
    { kind: "slider", label: "Font size", value: appearance.size, min: 8, max: 64, step: 1, unit: "",
      onChange: (size, undoable) => change({ style: { ...appearance, size } }, undoable) },
    { kind: "note", text: "Drag the text on the video to place it." },
  ] }];
  return <>
    <InspectorSections sections={sections} />
  </>;
}
