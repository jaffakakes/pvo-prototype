import type {
  CompletedExport,
  ExportFormat,
} from "../../domain/publishing/model";
import { formatFileSize } from "../publishing/SharePanel";
import { exportClock } from "./presentation";
import styles from "./ExportSheet.module.css";

type Props = {
  artifact: CompletedExport;
  format: ExportFormat;
  coverImage: string | null;
  width: number;
  height: number;
  duration: number;
  onDownload(): void;
  onShare(): void;
  onAgain(): void;
};

export function ExportResult({
  artifact,
  format,
  coverImage,
  width,
  height,
  duration,
  onDownload,
  onShare,
  onAgain,
}: Props) {
  return (
    <>
      <span className={`${styles.readyBadge} ${styles.phoneReadyBadge}`}>
        ✓ &nbsp;READY
      </span>
      <div className={styles.fileCard}>
        <span className={styles.fileCover}>
          {coverImage && <img src={coverImage} alt="Export cover" />}
        </span>
        <span>
          <strong>{artifact.filename}</strong>
          <small>
            {format === "pvo" ? "PVO · Interactive" : "Video"} · {width} ×{" "}
            {height}
          </small>
          <small>
            {exportClock(duration, false)} ·{" "}
            {formatFileSize(artifact.blob.size)} · Cover{" "}
            {exportClock(artifact.coverAt, false)}
          </small>
        </span>
      </div>
      <div className={`${styles.doneActions} ${styles.desktopReadyActions}`}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            void onDownload();
          }}
        >
          ↓ &nbsp;Download
        </button>
        <button
          type="button"
          className={styles.shareAction}
          data-export-share
          onClick={() => {
            void onShare();
          }}
        >
          Share
        </button>
      </div>
      <p className={styles.readyNote}>
        Share opens alongside — this result stays put. The cover is saved with
        your project and frozen for this export.
      </p>
      <button
        type="button"
        className={`${styles.linkAction} ${styles.desktopReadyActions}`}
        onClick={() => onAgain()}
      >
        Export again with different settings
      </button>
    </>
  );
}
