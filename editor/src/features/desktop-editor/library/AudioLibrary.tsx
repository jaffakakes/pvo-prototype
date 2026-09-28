import { useCapture } from "../../../state/captureStore";
import { setLibraryMusic } from "../../../state/editing/libraryCommands";
import { previewSound } from "../../../infrastructure/audio/sound";
import { Icon } from "../../../ui/Icon";
import { SOUNDS } from "../../sound/catalog";
import { LibraryHeading, LibraryNotice } from "./LibraryParts";
import styles from "./Library.module.css";

export function AudioLibrary({ section, query }: { section: string; query: string }) {
  const sound = useCapture(state => state.sound);
  if (section === "sfx") return <>
    <LibraryHeading>Sound FX</LibraryHeading>
    <LibraryNotice>Sound effects are not available in this beta.</LibraryNotice>
    {["Whoosh", "Shutter", "Record scratch", "Pop"].filter(name => name.toLowerCase().includes(query.toLowerCase())).map(name => <div className={styles.audioRow} key={name} data-unavailable>
      <span className={styles.audioThumb}><Icon name="music" size={16} /></span>
      <span className={styles.audioInfo}><strong>{name}</strong><small>Unavailable</small></span>
      <button type="button" disabled aria-label={`Add ${name}`}><Icon name="plus" size={15} /></button>
    </div>)}
  </>;
  const items = SOUNDS.map((track, index) => ({ track, index }))
    .filter(({ track }) => track.name.toLowerCase().includes(query.toLowerCase()));
  return <>
    <LibraryHeading count={`${items.length} items`}>Music</LibraryHeading>
    {items.map(({ track, index }) => <div className={styles.audioRow} key={track.name}>
      <button type="button" className={styles.audioThumb} style={{ backgroundColor: track.color }}
        disabled={!index} aria-label={`Preview ${track.name}`} onClick={() => previewSound(index)}><Icon name="play" size={15} /></button>
      <span className={styles.audioInfo}><strong>{track.name}</strong><small>{index ? "Instrumental loop" : "From your clips"}</small></span>
      {sound === index && <span className={styles.inUse}>IN USE</span>}
      <button type="button" aria-label={`Use ${track.name}`} onClick={() => setLibraryMusic(index)}><Icon name="plus" size={15} /></button>
    </div>)}
  </>;
}
