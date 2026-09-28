import type { Ratio } from "../../domain/project/model";
import { total } from "../../domain/clips/timing";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { MediaInput } from "./MediaInput";
import { RatioPicker } from "./RatioPicker";
import type { PreparedMedia } from "./useProjectMedia";
import common from "./CreateProject.module.css";
import styles from "./DropReadyPanel.module.css";

type Props = {
  media: PreparedMedia[];
  progress: { done: number; count: number } | null;
  name: string;
  ratio: Ratio;
  busy: boolean;
  starting: boolean;
  unavailable: boolean;
  onNameChange(value: string): void;
  onRatioChange(value: Ratio): void;
  onPick(): void;
  onRemove(id: number): void;
  onStart(): void;
};

/** The ready state of the drop-first landing shares the same staged media and create command. */
export function DropReadyPanel(props: Props) {
  const { media, progress, name, ratio, busy, starting, unavailable } = props;
  const percent = progress?.count ? Math.round(progress.done / progress.count * 100) : null;
  return <section className={styles.ready} aria-labelledby="create-title">
    <div className={styles.status}>
      <h1 id="create-title"><i />Clips are in — set up your edit</h1>
      <span>{media.length} {media.length === 1 ? "clip" : "clips"} · {fmt(total(media.map(item => item.clip)))}{percent !== null ? ` · preparing ${percent}%` : ""}</span>
    </div>
    <form className={styles.strip} onSubmit={event => { event.preventDefault(); if (!busy && !unavailable) props.onStart(); }}>
      <div className={styles.media}>
        <MediaInput media={media} progress={null} disabled={busy} onPick={props.onPick} onRemove={props.onRemove} compact />
        {progress && <div className={styles.preparing} role="status"><i />Preparing your clips{percent !== null ? ` · ${percent}%` : "…"}</div>}
      </div>
      <div className={styles.divider} />
      <div className={styles.settings}>
        <label className={common.name}>Project name<input value={name} maxLength={120} placeholder="Untitled edit" disabled={starting}
          onFocus={event => props.onNameChange(event.currentTarget.value)} onChange={event => props.onNameChange(event.target.value)} /></label>
        <RatioPicker value={ratio} onChange={props.onRatioChange} disabled={starting} compact />
      </div>
      <div className={styles.start}>
        <button type="submit" className={common.primary} disabled={!media.length || busy || unavailable}>
          {starting ? "Opening your edit…" : "Start editing"}<Icon name="arrow" size={18} />
        </button>
        <p>Sign up only when you export.</p>
      </div>
    </form>
  </section>;
}
