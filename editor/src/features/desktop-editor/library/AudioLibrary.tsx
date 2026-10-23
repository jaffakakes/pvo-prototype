import { useCapture } from "../../../state/captureStore";
import { setLibraryMusic } from "../../../state/editing/libraryCommands";
import { previewSound } from "../../../infrastructure/audio/sound";
import { Icon } from "../../../ui/Icon";
import { SOUNDS } from "../../sound/catalog";
import { LibraryHeading } from "./LibraryParts";
import { SoundEffectsList } from "../../sound/SoundEffectsList";
import styles from "./Library.module.css";

export function AudioLibrary({
  section,
  query,
}: {
  section: string;
  query: string;
}) {
  const sound = useCapture((state) => state.music?.track ?? 0);
  if (section === "sfx")
    return (
      <>
        <LibraryHeading>Sound FX</LibraryHeading>
        <SoundEffectsList query={query} />
      </>
    );
  const items = SOUNDS.map((track, index) => ({ track, index })).filter(
    ({ track }) => track.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <LibraryHeading count={`${items.length} items`}>Music</LibraryHeading>
      {items.map(({ track, index }) => (
        <div className={styles.audioRow} key={track.name}>
          <button
            type="button"
            className={styles.audioThumb}
            style={{ backgroundColor: track.color }}
            disabled={!index}
            aria-label={`Preview ${track.name}`}
            onClick={() => previewSound(index)}
          >
            <Icon name="play" size={15} />
          </button>
          <span className={styles.audioInfo}>
            <strong>{track.name}</strong>
            <small>{index ? "Instrumental loop" : "From your clips"}</small>
          </span>
          {sound === index && <span className={styles.inUse}>IN USE</span>}
          <button
            type="button"
            aria-label={`Use ${track.name}`}
            onClick={() => setLibraryMusic(index)}
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
      ))}
    </>
  );
}
