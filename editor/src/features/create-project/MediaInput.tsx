import { useState } from "react";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import type { PreparedMedia } from "./useProjectMedia";
import styles from "./CreateProject.module.css";

type Props = {
  media: PreparedMedia[];
  progress: { done: number; count: number } | null;
  disabled: boolean;
  compact?: boolean;
  onPick(): void;
  onRemove(id: number): void;
};

export function MediaInput({ media, progress, disabled, compact = false, onPick, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false);
  const first = media[0];
  return <div className={styles.mediaInput} data-compact={compact}>
    <div className={styles.labelRow}>
      <span>Media</span>
      {!!media.length && <button type="button" disabled={disabled} onClick={onPick}><Icon name="plus" size={14} />Add more</button>}
    </div>
    {!first ? <button type="button" className={styles.dropzone} onClick={onPick} disabled={disabled}>
      <span className={styles.uploadIcon}><Icon name="export" size={24} /></span>
      <strong>Drop files here or click to upload</strong>
      <span>MP4, MOV or HEVC · up to 2 GB</span>
    </button> : <div className={styles.mediaReady}>
      <div className={styles.clipStack}>
        <video src={first.clip.url ?? undefined} muted playsInline preload="metadata" aria-label="First clip preview" />
        <div><strong>{first.file.name}</strong><span>{Math.max(.1, first.file.size / 1024 / 1024).toFixed(1)} MB · {fmt(first.clip.srcDur)} · 1 of {media.length}</span></div>
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{media.length} {media.length === 1 ? "clip" : "clips"}</button>
      </div>
      {expanded && <ul className={styles.clipList} aria-label="All clips">
        {media.map(({ file, clip }) => <li key={clip.id}>
          <span>{file.name}</span>
          <button type="button" disabled={disabled} onClick={() => onRemove(clip.id)} aria-label={`Remove ${file.name}`}><Icon name="close" size={15} /></button>
        </li>)}
      </ul>}
      {!progress && !compact && <div className={styles.mediaStatus}><Icon name="check" size={20} /><div><strong>Clips are ready</strong><span>Name your edit and choose a ratio.</span></div></div>}
    </div>}
    {progress && <div className={styles.mediaStatus} role="status">
      <span className={styles.spinner} />
      <div><strong>{progress.count ? "Preparing your clips…" : "Loading sample…"}</strong>
        {progress.count > 0 && <progress max={progress.count} value={progress.done} aria-label="Preparing clips" />}
      </div>
      {progress.count > 0 && <span>{Math.round(progress.done / progress.count * 100)}%</span>}
    </div>}
  </div>;
}
