import { useCapture } from "../../state/captureStore";
import { replaceFailedRecording, useRecordingIssues } from "./recordingIssues";
import { dismissImportResult, retryFailedImports, useVideoImportStatus } from "./videoImport";
import styles from "./CaptureRecovery.module.css";

export function CaptureRecovery() {
  const result = useVideoImportStatus(state => state.result);
  const issues = useRecordingIssues(state => state.issues);
  const scenes = useCapture(state => state.scenes);
  const busy = useCapture(state => state.importing || state.recording);
  const active = issues.flatMap(issue => {
    const scene = scenes.find(item => item.clips.some(clip => clip.id === issue.clipId));
    return scene ? [{ ...issue, scene, index: scene.clips.findIndex(clip => clip.id === issue.clipId) }] : [];
  });
  if (!result && !active.length) return null;
  return <section className={styles.recovery} aria-label="Capture recovery">
    {result && <div>
      <h3>Import results</h3>
      <p>{result.imported} imported. Choose another file or retry these files:</p>
      <ul>{result.failed.map((file, index) => <li key={`${index}:${file.name}`}>{file.name}</li>)}</ul>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => { void retryFailedImports(); }}>{busy ? "Importing…" : "Retry failed files"}</button>
        <button type="button" disabled={busy} onClick={dismissImportResult}>Clear import results</button>
      </div>
    </div>}
    {active.map(issue => <div key={issue.clipId}>
      <h3>{issue.scene.name} · Clip {issue.index + 1}</h3>
      <p>{issue.detail}</p>
      <button type="button" disabled={busy} onClick={() => replaceFailedRecording(issue.clipId)}>Record again</button>
    </div>)}
  </section>;
}
