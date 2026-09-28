import { useMemo } from "react";
import type { Clip } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { addLibrarySource } from "../../../state/editing/libraryCommands";
import { Icon } from "../../../ui/Icon";
import { fmt } from "../../../ui/formatTime";
import { CaptureRecovery } from "../../capture/CaptureRecovery";
import { ClipPoster } from "../../../ui/media/ClipPoster";
import { AddBadge, LibraryHeading, LibraryNotice } from "./LibraryParts";
import type { LibraryMedia } from "./useLibraryMedia";
import styles from "./Library.module.css";

function uniqueMedia(scenes: { clips: Clip[] }[]) {
  const seen = new Set<string | number>();
  return scenes.flatMap(scene => scene.clips).filter(clip => {
    const key = clip.url ?? clip.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function MediaLibrary({ section, query, media }: { section: string; query: string; media: LibraryMedia }) {
  const scenes = useCapture(state => state.scenes);
  const sources = useMemo(() => uniqueMedia(scenes), [scenes]);
  const items = sources.map((clip, index) => ({ clip, label: `Clip ${index + 1}` }))
    .filter(item => item.label.toLowerCase().includes(query.toLowerCase()));

  if (section === "samples") return <>
    <LibraryHeading count="1 sample">Samples</LibraryHeading>
    {"restyle sample".includes(query.toLowerCase()) && <button type="button" className={styles.tile} disabled={media.importing} onClick={media.loadSample}>
      <span className={styles.thumb}>
        <ClipPoster clip={{ url: new URL("./samples/restyle-sample.mp4", location.href).href, in: 0, color: "#15151C" }} />
        <AddBadge />
      </span>
      <strong>Restyle sample</strong>
    </button>}
    <LibraryNotice>Try the editor with a real sample clip.</LibraryNotice>
  </>;

  return <>
    <LibraryHeading count={`${items.length} ${items.length === 1 ? "clip" : "clips"}`}>Your clips</LibraryHeading>
    <div className={styles.grid}>
      {media.progress && <div className={styles.tile} role="status">
        <div className={`${styles.thumb} ${styles.importing}`}><span className={styles.spinner} /></div>
        <strong>Reading media…</strong>
        <small>{media.progress.done} of {media.progress.count || "…"}</small>
      </div>}
      {items.map(({ clip, label }) => <button type="button" key={clip.id} className={styles.tile}
        disabled={media.importing} aria-label={`Add ${label} to timeline`} onClick={() => addLibrarySource(clip)}>
        <span className={styles.thumb}>
          <ClipPoster clip={{ ...clip, in: 0 }} />
          <span className={styles.duration}>{fmt(clip.srcDur)}</span>
          <AddBadge />
        </span>
        <strong>{label}</strong>
        <small>{clip.width} × {clip.height}</small>
      </button>)}
    </div>
    {!sources.length && !media.importing && <LibraryNotice>Add your first clip to start shaping your story.</LibraryNotice>}
    <button type="button" className={styles.importButton} disabled={media.importing} onClick={media.openPicker}>
      <Icon name="plus" size={16} />{media.importing ? "Importing media…" : "Import media"}
    </button>
    <CaptureRecovery />
  </>;
}
