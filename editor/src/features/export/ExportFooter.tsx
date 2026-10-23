import type { ExportQuality } from "../../domain/publishing/model";
import type { ExportView } from "./presentation";
import styles from "./ExportSheet.module.css";

type Props = {
  mode: ExportView;
  quality: ExportQuality;
  unavailable: boolean;
  begin(): void;
  saveCover(): void;
  cancel(): void;
  download(): void;
  share(): void;
  retry720(): void;
  backToSettings(): void;
};

export function ExportFooter({
  mode,
  quality,
  unavailable,
  begin,
  saveCover,
  cancel,
  download,
  share,
  retry720,
  backToSettings,
}: Props) {
  if (mode === "gate") return null;
  return (
    <footer className={styles.footer}>
      {mode === "setup" && (
        <>
          <p>Your PVO opens through a shareable Restyle link.</p>
          <button
            type="button"
            className={styles.primary}
            disabled={unavailable}
            onClick={begin}
          >
            ↑ &nbsp;Export and share · {quality}
          </button>
        </>
      )}
      {mode === "picker" && (
        <>
          <p>Frozen for this export; you can change it later.</p>
          <button type="button" className={styles.primary} onClick={saveCover}>
            ✓ &nbsp;Use this frame
          </button>
        </>
      )}
      {mode === "exporting" && (
        <>
          <p>Progress continues if you pause the preview.</p>
          <button type="button" className={styles.quietAction} onClick={cancel}>
            Cancel export
          </button>
        </>
      )}
      {mode === "done" && (
        <div className={styles.doneActions}>
          <button
            type="button"
            className={styles.shareAction}
            data-export-share
            onClick={() => {
              void share();
            }}
          >
            View share link
          </button>
          <button
            type="button"
            className={styles.quietAction}
            onClick={() => {
              void download();
            }}
          >
            ↓ &nbsp;Download PVO
          </button>
          <button
            type="button"
            className={styles.linkAction}
            onClick={() => backToSettings()}
          >
            Export again with different settings
          </button>
        </div>
      )}
      {mode === "failed" && (
        <div className={styles.failedActions}>
          <button type="button" className={styles.primary} onClick={begin}>
            Retry
          </button>
          <button
            type="button"
            className={styles.quietAction}
            onClick={retry720}
          >
            Retry at 720p
          </button>
          <button
            type="button"
            className={styles.linkAction}
            onClick={() => {
              backToSettings();
            }}
          >
            Back to settings
          </button>
        </div>
      )}
    </footer>
  );
}
