import type {
  ExportFormat,
  ExportQuality,
} from "../../domain/publishing/model";
import type { ExportView } from "./presentation";
import styles from "./ExportSheet.module.css";

type Props = {
  mode: ExportView;
  format: ExportFormat;
  quality: ExportQuality;
  unavailable: boolean;
  close(): void;
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
  format,
  quality,
  unavailable,
  close,
  begin,
  saveCover,
  cancel,
  download,
  share,
  retry720,
  backToSettings,
}: Props) {
  return (
    <footer className={styles.footer}>
      {mode === "gate" && (
        <>
          <p>Sign in or create an account with Google or email.</p>
          <button type="button" className={styles.quietAction} onClick={close}>
            Keep editing
          </button>
        </>
      )}
      {mode === "setup" && (
        <>
          <p>
            {format === "pvo"
              ? "Opens in the Restyle player; shared links show the cover."
              : "Interactive elements are left out of video exports."}
          </p>
          <button
            type="button"
            className={styles.primary}
            disabled={unavailable}
            onClick={begin}
          >
            ↑ &nbsp;Export {format === "pvo" ? ".pvo" : "video"} · {quality}
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
            className={styles.primary}
            onClick={() => {
              void download();
            }}
          >
            ↓ &nbsp;Download
          </button>
          <button
            type="button"
            className={styles.shareAction}
            data-export-share
            onClick={() => {
              void share();
            }}
          >
            Share
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
