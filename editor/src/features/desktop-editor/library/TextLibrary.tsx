import type { CSSProperties } from "react";
import { TEXT_FONTS, TEXT_PRESETS } from "../../../../../packages/pvo-text-runtime/index.js";
import { addLibraryText } from "../../../state/editing/libraryCommands";
import { AddBadge, LibraryHeading } from "./LibraryParts";
import styles from "./Library.module.css";

export function TextLibrary({ section, query }: { section: string; query: string }) {
  const allowed = section === "titles" ? ["headline", "caption", "editorial"]
    : section === "lower" ? ["clean", "label", "typewriter"] : TEXT_PRESETS.map(item => item.id);
  const items = TEXT_PRESETS.filter(item => allowed.includes(item.id) && item.name.toLowerCase().includes(query.toLowerCase()));
  const label = section === "titles" ? "Titles" : section === "lower" ? "Lower thirds" : "Presets";
  return <>
    <LibraryHeading count={`${items.length} items`}>{label}</LibraryHeading>
    <div className={styles.grid}>
      {items.map(preset => {
        const preview: CSSProperties = {
          fontFamily: TEXT_FONTS[preset.style.font], fontWeight: preset.style.bold ? 800 : 500,
          fontStyle: preset.style.italic ? "italic" : "normal", color: preset.style.fill,
          backgroundColor: preset.style.background, WebkitTextStroke: `${preset.style.strokeWidth * .6}px ${preset.style.stroke}`,
          textShadow: preset.style.shadow ? "2px 2px 0 #000" : undefined,
        };
        return <button type="button" key={preset.id} className={styles.tile}
          aria-label={`Add ${preset.name} text`}
          onClick={() => addLibraryText(section === "lower" ? "Your name" : preset.sample, preset.style, section === "lower" ? 82 : 18)}>
          <span className={styles.thumb}><span className={styles.typePreview} style={preview}>Aa</span><AddBadge /></span>
          <strong>{preset.name}</strong>
        </button>;
      })}
    </div>
  </>;
}
