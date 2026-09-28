import { useRef } from "react";
import { dur, total } from "../../domain/clips/timing";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { importVideos } from "../capture/videoImport";
import { CaptureRecovery } from "../capture/CaptureRecovery";
import styles from "./MediaPanel.module.css";

export function MediaPanel() {
  const clips = useCapture(state => state.clips);
  const selected = useCapture(state => state.sel);
  const importing = useCapture(state => state.importing);
  const input = useRef<HTMLInputElement>(null);
  return <aside className={styles.panel} aria-label="Project media">
    <div className={styles.heading}><h2>Media</h2><span>{clips.length} clips</span></div>
    <button type="button" className={styles.upload} disabled={importing} onClick={() => input.current?.click()}><Icon name="export" size={18} />{importing ? "Importing…" : "Upload clips"}</button>
    <input ref={input} type="file" accept="video/*,.mp4,.mov" multiple hidden aria-label="Add video clips" onChange={event => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      void importVideos(files);
    }} />
    <div className={styles.list}>
      {clips.map((clip, index) => <button type="button" key={clip.id} className={styles.clip} aria-pressed={index === selected} onClick={() => {
        useCapture.getState().patch({ sel: index, t: total(clips.slice(0, index)), playing: false });
      }}>
        <div style={{ background: clip.color }}>{clip.url && <video src={clip.url} muted playsInline preload="metadata" />}<span>{fmt(dur(clip))}</span></div>
        <strong>Clip {index + 1}</strong><small>{clip.width} × {clip.height}</small>
      </button>)}
      {!clips.length && <p>Upload your first clip to start shaping your story.</p>}
    </div>
    <CaptureRecovery />
    <button type="button" className={styles.record} disabled={importing} onClick={() => {
      const state = useCapture.getState();
      state.startRecordingIntoScene(state.currentSceneId);
    }}><Icon name="camera" size={17} />Record a clip</button>
    <p className={styles.footer}>Your original clips stay in this browser.</p>
  </aside>;
}
