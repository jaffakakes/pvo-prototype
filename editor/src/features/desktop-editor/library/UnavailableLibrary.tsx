import { Icon } from "../../../ui/Icon";
import { EFFECTS, TRANSITIONS } from "./catalog";
import { LibraryHeading, LibraryNotice } from "./LibraryParts";
import styles from "./Library.module.css";

type Props = { tab: string; section: string; label: string; query: string };

/** Catalog navigation stays visible without suggesting unimplemented edits were applied. */
export function UnavailableLibrary({ tab, section, label, query }: Props) {
  if (tab === "captions" && section === "auto") return <>
    <LibraryHeading>Auto captions</LibraryHeading>
    <div className={styles.generate}>
      <span className={styles.generateIcon}>CC</span>
      <strong>Turn speech into captions</strong>
      <p>Generate captions from the audio in this scene.</p>
      <button type="button" disabled>Generate captions</button>
      <small>Transcription is not available in this beta.</small>
    </div>
  </>;
  const catalog = tab === "effects" ? EFFECTS[section] ?? []
    : tab === "transitions" ? TRANSITIONS[section] ?? []
    : ["Bold pop", "Clean", "Karaoke", "Boxed", "Outline", "Neon"];
  const items = catalog.filter(item => item.toLowerCase().includes(query.toLowerCase()));
  const feature = tab === "effects" ? "Effects" : tab === "transitions" ? "Transitions" : "Automatic captions";
  return <>
    <LibraryHeading count={`${items.length} items`}>{label}</LibraryHeading>
    <LibraryNotice>{feature} are not available in this beta.</LibraryNotice>
    <div className={styles.grid}>
      {items.map(item => <button type="button" key={item} className={styles.tile} disabled title={`${item} is not available yet`}>
        <span className={styles.thumb}>
          {tab === "captions" ? <span className={styles.typePreview}>Aa</span>
            : <Icon name={tab === "transitions" ? "replace" : "lock"} size={24} />}
        </span>
        <strong>{item}</strong>
      </button>)}
    </div>
  </>;
}
